import mongoose from 'mongoose';
import type { CookieOptions, RequestHandler, Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { AppEnv } from '../../config/env.js';
import { AppError } from '../../shared/errors/AppError.js';
import { generateToken, hashPassword, hashToken, verifyPassword } from '../../shared/utils/crypto.js';
import { createMailTransport } from '../notification/notification.transport.js';
import { CustomerModel } from './customer.schema.js';
import {
  CustomerAccountModel,
  CustomerSessionModel,
  CustomerEventModel,
  type CustomerAccount,
  type CustomerEventKind,
} from './account.schema.js';
import type { z } from 'zod';
import type { accountRegistration } from './account.validator.js';

export const CUSTOMER_COOKIE = 'medaxis_customer_session';
const idle = 30 * 60_000;
const absolute = 12 * 60 * 60_000;
export const customerCookieOptions = (env: AppEnv): CookieOptions => ({
  httpOnly: true,
  signed: true,
  secure: env.isProduction,
  sameSite: 'strict',
  path: '/v1/public/customer',
});
export interface CustomerIdentity {
  account: CustomerAccount;
  sessionId: string;
}
export const customerIdentity = (res: Response) => res.locals.customerIdentity as CustomerIdentity;
export function verifiedCustomer(res: Response) {
  const account = customerIdentity(res).account;
  if (!account.email_verified_at || !account.customer_id)
    throw AppError.forbidden('Verify your email before opening RFQs and quotations.');
  return account.customer_id;
}
export function customerAuth(env: AppEnv): RequestHandler {
  return async (req, res, next) => {
    try {
      const token: unknown = req.signedCookies?.[CUSTOMER_COOKIE];
      if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw AppError.unauthorized();
      const now = new Date();
      const session = await CustomerSessionModel.findOne({
        token_hash: hashToken(token),
        expires_at: { $gt: now },
        absolute_expires_at: { $gt: now },
      }).lean();
      if (!session) throw AppError.unauthorized();
      const account = await CustomerAccountModel.findOne({
        _id: session.account_id,
        is_active: true,
        session_generation: session.session_generation,
      }).lean();
      if (!account) throw AppError.unauthorized();
      const expires = new Date(Math.min(Date.now() + idle, session.absolute_expires_at.getTime()));
      const renewed = await CustomerSessionModel.updateOne(
        { _id: session._id, token_hash: session.token_hash, expires_at: { $gt: now } },
        { $max: { expires_at: expires } },
      );
      if (!renewed.matchedCount) throw AppError.unauthorized();
      res.locals.customerIdentity = { account, sessionId: session._id } satisfies CustomerIdentity;
      res.cookie(CUSTOMER_COOKIE, token, { ...customerCookieOptions(env), maxAge: expires.getTime() - Date.now() });
      next();
    } catch (error) {
      next(error);
    }
  };
}
export interface CustomerAuthHooks {
  deliverLink?: (email: string, url: string, purpose: 'verify' | 'reset') => Promise<void>;
  dispatchNotifications?: () => void | Promise<void>;
}
export function createCustomerAuthService(env: AppEnv, hooks: CustomerAuthHooks = {}) {
  const mail = createMailTransport(env);
  let dummyHash: Promise<string> | undefined;
  async function event(accountId: string, kind: CustomerEventKind, referenceId?: string) {
    await CustomerEventModel.create({
      account_id: accountId,
      kind,
      ...(referenceId ? { reference_id: referenceId } : {}),
    });
  }
  async function issue(account: CustomerAccount, res: Response) {
    const token = generateToken();
    await CustomerSessionModel.create({
      account_id: account._id,
      token_hash: hashToken(token),
      session_generation: account.session_generation,
      expires_at: new Date(Date.now() + idle),
      absolute_expires_at: new Date(Date.now() + absolute),
    });
    res.cookie(CUSTOMER_COOKIE, token, { ...customerCookieOptions(env), maxAge: idle });
  }
  async function sendLink(account: CustomerAccount, purpose: 'verify' | 'reset') {
    if (!hooks.deliverLink && !mail.ready()) return false;
    const token = generateToken();
    const field = purpose === 'verify' ? 'verification' : 'password_reset';
    await CustomerAccountModel.updateOne(
      { _id: account._id, is_active: true },
      {
        $set: {
          [field]: {
            token_hash: hashToken(token),
            expires_at: new Date(Date.now() + (purpose === 'verify' ? 24 * 60 * 60_000 : 30 * 60_000)),
          },
        },
      },
    );
    const origin = new URL(env.PUBLIC_ORIGIN[0]!);
    const url = new URL(`/${account.preferred_locale}/account/${purpose}`, origin);
    url.hash = token;
    try {
      if (hooks.deliverLink) await hooks.deliverLink(account.email, url.href, purpose);
      else {
        const chinese = account.preferred_locale === 'zh-CN';
        const subject = chinese
          ? purpose === 'verify'
            ? '验证您的 MedAxis 邮箱'
            : '重设 MedAxis 密码'
          : purpose === 'verify'
            ? 'Verify your MedAxis email'
            : 'Reset your MedAxis password';
        const escaped = url.href.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
        await mail.send(
          env.RESEND_API_KEY ? 'RESEND' : 'BREVO',
          account.email,
          {
            subject,
            text: `${subject}\n${url.href}`,
            html: `<p>${subject}</p><p><a href="${escaped}">${subject}</a></p>`,
            locale: account.preferred_locale as 'en' | 'zh-CN',
          },
          `customer-${purpose}:${hashToken(token)}`,
          randomUUID(),
        );
      }
      return true;
    } catch {
      return false;
    }
  }
  async function profile(account: CustomerAccount) {
    const contact =
      account.email_verified_at && account.customer_id
        ? await CustomerModel.findById(account.customer_id).lean()
        : null;
    return {
      id: account._id,
      email: account.email,
      email_verified: Boolean(account.email_verified_at),
      full_name: contact?.full_name ?? account.full_name,
      customer_type: contact?.customer_type ?? account.customer_type,
      company_name: contact?.company_name ?? account.company_name ?? '',
      country: contact?.country ?? account.country,
      city: contact?.city ?? account.city ?? '',
      whatsapp_number: contact?.whatsapp_number ?? account.whatsapp_number ?? '',
      wechat_id: contact?.wechat_id ?? account.wechat_id ?? '',
      preferred_locale: contact?.preferred_locale ?? account.preferred_locale,
    };
  }
  async function register(input: z.infer<typeof accountRegistration>, res: Response) {
    if (await CustomerAccountModel.exists({ email: input.email }))
      throw AppError.conflict('An account already exists. Sign in or reset your password.');
    const { password, turnstile_token: _turnstileToken, ...details } = input;
    let account;
    try {
      account = await CustomerAccountModel.create({ ...details, password_hash: await hashPassword(password) });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 11000)
        throw AppError.conflict('An account already exists. Sign in or reset your password.');
      throw error;
    }
    await event(account._id, 'REGISTERED');
    const verificationSent = await sendLink(account.toObject(), 'verify');
    await issue(account.toObject(), res);
    return { profile: await profile(account.toObject()), verification_sent: verificationSent };
  }
  async function login(email: string, password: string, res: Response) {
    const account = await CustomerAccountModel.findOne({ email }).select('+password_hash').lean();
    if (account?.locked_until && account.locked_until > new Date())
      throw AppError.tooManyRequests(Math.ceil((account.locked_until.getTime() - Date.now()) / 1000));
    const valid = await verifyPassword(
      account?.password_hash ?? (await (dummyHash ??= hashPassword(generateToken()))),
      password,
    );
    if (!account?.is_active || !valid) {
      if (account) {
        const failure = await CustomerAccountModel.findOneAndUpdate(
          { _id: account._id },
          [
            {
              $set: {
                failed_count: {
                  $cond: [
                    { $lte: [{ $ifNull: ['$locked_until', new Date(8640000000000000)] }, new Date()] },
                    1,
                    { $add: ['$failed_count', 1] },
                  ],
                },
              },
            },
            {
              $set: {
                locked_until: {
                  $cond: [{ $gte: ['$failed_count', 5] }, new Date(Date.now() + 15 * 60_000), '$$REMOVE'],
                },
              },
            },
          ],
          { updatePipeline: true, returnDocument: 'after' },
        ).lean();
        if (failure?.locked_until) throw AppError.tooManyRequests(900);
      }
      throw AppError.unauthorized('Email or password was not confirmed.');
    }
    await CustomerAccountModel.updateOne(
      { _id: account._id },
      { $set: { failed_count: 0 }, $unset: { locked_until: 1 } },
    );
    await issue(account, res);
    await event(account._id, 'SIGNED_IN');
    return { profile: await profile(account) };
  }
  async function verify(token: string) {
    return mongoose.connection.transaction(async (session) => {
      const account = await CustomerAccountModel.findOne({
        'verification.token_hash': hashToken(token),
        'verification.expires_at': { $gt: new Date() },
        email_verified_at: { $exists: false },
        is_active: true,
      }).session(session);
      if (!account) throw AppError.badRequest('This verification link is invalid or expired.');
      let customer = await CustomerModel.findOne({ email: account.email }).session(session);
      if (!customer)
        customer = await new CustomerModel({
          email: account.email,
          full_name: account.full_name,
          customer_type: account.customer_type,
          company_name: account.company_name || undefined,
          country: account.country,
          preferred_locale: account.preferred_locale,
          city: account.city || undefined,
          whatsapp_number: account.whatsapp_number || undefined,
          wechat_id: account.wechat_id || undefined,
        }).save({ session });
      const updated = await CustomerAccountModel.findOneAndUpdate(
        { _id: account._id, 'verification.token_hash': hashToken(token) },
        { $set: { customer_id: customer._id, email_verified_at: new Date() }, $unset: { verification: 1 } },
        { session, returnDocument: 'after' },
      ).lean();
      if (!updated) throw AppError.conflict();
      await new CustomerEventModel({ account_id: account._id, kind: 'EMAIL_VERIFIED' }).save({ session });
      return { verified: true };
    });
  }
  async function reset(token: string, password: string) {
    const passwordHash = await hashPassword(password);
    const account = await CustomerAccountModel.findOneAndUpdate(
      {
        'password_reset.token_hash': hashToken(token),
        'password_reset.expires_at': { $gt: new Date() },
        is_active: true,
      },
      {
        $set: { password_hash: passwordHash, failed_count: 0 },
        $inc: { session_generation: 1 },
        $unset: { password_reset: 1, locked_until: 1 },
      },
      { returnDocument: 'after' },
    ).lean();
    if (!account) throw AppError.badRequest('This reset link is invalid or expired.');
    await CustomerSessionModel.deleteMany({ account_id: account._id });
    await event(account._id, 'PASSWORD_CHANGED');
    return { reset: true };
  }
  return {
    event,
    profile,
    register,
    login,
    verify,
    reset,
    sendLink,
    mailReady: () => Boolean(hooks.deliverLink) || mail.ready(),
  };
}
