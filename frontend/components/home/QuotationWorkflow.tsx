import { getTranslations } from 'next-intl/server';
import { ArrowRight, CheckCircle2, ClipboardList, FileCheck2, Lock, Truck } from 'lucide-react';
import type { Locale } from '../../i18n/routing';
import { QuoteButton } from '../layout/PublicShell';

const WORKFLOW_STEPS = [
  { key: 'stepOne', number: '01', Icon: ClipboardList },
  { key: 'stepTwo', number: '02', Icon: FileCheck2 },
  { key: 'stepThree', number: '03', Icon: CheckCircle2 },
  { key: 'stepFour', number: '04', Icon: Truck },
] as const;

export async function QuotationWorkflow({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'Home' });
  return (
    <section className="process-section" id="workflow" aria-labelledby="workflow-heading">
      <div className="section site-container">
        <div className="centered-heading">
          <p className="eyebrow">{t('processKicker')}</p>
          <h2 id="workflow-heading">{t('processTitle')}</h2>
          <p className="section-intro">{t('processDescription')}</p>
        </div>

        <ol className="process-grid">
          {WORKFLOW_STEPS.map(({ key, number, Icon }) => (
            <li key={key} className="process-step-card">
              <div className="process-step-top">
                <span className="process-step-icon" aria-hidden="true">
                  <Icon size={21} strokeWidth={1.7} />
                </span>
                <span className="process-step-num">{number}</span>
              </div>
              <h3>{t(`${key}Title`)}</h3>
              <p>{t(`${key}Body`)}</p>
              <span className="process-step-tag">{t(`${key}Tag`)}</span>
            </li>
          ))}
        </ol>

        <div className="final-cta">
          <div className="final-cta-copy">
            <p className="final-cta-kicker">
              <Lock size={13} aria-hidden="true" />
              {t('ctaKicker')}
            </p>
            <h2>{t('ctaTitle')}</h2>
            <p>{t('ctaBody')}</p>
          </div>
          <QuoteButton>
            {t('request')}
            <ArrowRight size={18} aria-hidden="true" />
          </QuoteButton>
        </div>
      </div>
    </section>
  );
}

