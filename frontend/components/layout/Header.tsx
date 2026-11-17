'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  ArrowRight,
  Bell,
  BookOpen,
  Building2,
  Calendar,
  ChevronDown,
  Facebook,
  FileCheck2,
  FlaskConical,
  Globe,
  Instagram,
  Layers,
  Linkedin,
  LogIn,
  Mail,
  Menu,
  Newspaper,
  Package,
  Phone,
  Pill,
  Plane,
  ShoppingBag,
  Snowflake,
  Sparkles,
  Twitter,
  UserPlus,
  X,
} from 'lucide-react';
import { LocaleSwitcher } from './LocaleSwitcher';
import type { ContactConfig } from '../../lib/public-config';

interface HeaderProps {
  itemCount: number;
  hydrated: boolean;
  onCart(): void;
  onContact(): void;
  onQuickQuote(): void;
  contact?: ContactConfig;
}

type DropdownKey = 'products' | 'services' | 'blog' | 'about';

interface DropdownItem {
  label: string;
  href: string;
  description?: string;
  Icon: typeof Pill;
}

interface DropdownGroup {
  id: DropdownKey;
  label: string;
  href: string;
  heading?: string;
  items: DropdownItem[];
}

export function Header({ itemCount, hydrated, onCart, onContact, onQuickQuote, contact }: HeaderProps) {
  const locale = useLocale();
  const pathname = usePathname();
  const t = useTranslations('Shell');
  const [menuOpen, setMenuOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<DropdownKey | null>(null);
  const [mobileOpenGroup, setMobileOpenGroup] = useState<DropdownKey | null>('products');
  const navRef = useRef<HTMLElement>(null);

  const email = contact?.email || 'info@medaxisglobalpharma.com';
  const phone = '+8801560064010';

  const isRouteActive = (route: string) => {
    const href = route ? `/${locale}/${route}` : `/${locale}`;
    if (!route) return pathname === href;
    return pathname === href || Boolean(pathname?.startsWith(`${href}/`));
  };

  useEffect(() => {
    setOpenMenu(null);
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!openMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (navRef.current && !navRef.current.contains(event.target as Node)) setOpenMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openMenu]);

  const dropdownGroups: DropdownGroup[] = [
    {
      id: 'products',
      label: t('products'),
      href: `/${locale}/products`,
      items: [
        { label: t('allProducts'), href: `/${locale}/products`, Icon: Pill },
        { label: t('newArrivals'), href: `/${locale}/#catalog`, Icon: Sparkles },
        { label: t('browseByGeneric'), href: `/${locale}/generics`, Icon: FlaskConical },
        { label: t('browseByManufacturer'), href: `/${locale}/manufacturers`, Icon: Building2 },
        { label: t('compareProducts'), href: `/${locale}/categories`, Icon: Layers },
      ],
    },
    {
      id: 'services',
      label: t('services'),
      href: `/${locale}/services`,
      items: [
        { label: t('coldChainLogistics'), href: `/${locale}/services#cold-chain`, Icon: Snowflake },
        { label: t('globalPharmaSourcing'), href: `/${locale}/services/pharmaceutical-sourcing`, Icon: Globe },
        { label: t('complianceCoa'), href: `/${locale}/services#compliance`, Icon: FileCheck2 },
        { label: t('emergencyDelivery'), href: `/${locale}/services#delivery`, Icon: Plane },
        { label: t('bulkFulfillment'), href: `/${locale}/services#bulk`, Icon: Package },
      ],
    },
    {
      id: 'blog',
      label: t('blog'),
      href: `/${locale}/blog`,
      items: [
        { label: t('latestArticles'), href: `/${locale}/blog#articles`, Icon: Newspaper },
        { label: t('productUpdates'), href: `/${locale}/blog#updates`, Icon: Bell },
        { label: t('buyerGuides'), href: `/${locale}/blog#guides`, Icon: BookOpen },
      ],
    },
    {
      id: 'about',
      label: t('about'),
      href: `/${locale}/about`,
      heading: t('companyInfo'),
      items: [
        { label: t('companyOverview'), description: t('companyOverviewDesc'), href: `/${locale}/about#overview`, Icon: Building2 },
        { label: t('newsEvents'), description: t('newsEventsDesc'), href: `/${locale}/about#news`, Icon: Calendar },
      ],
    },
  ];

  const isGroupActive = (id: DropdownKey) => {
    if (id === 'products') return isRouteActive('products') || isRouteActive('generics') || isRouteActive('manufacturers') || isRouteActive('categories');
    return isRouteActive(id);
  };

  return <>
    <a className="skip-link" href="#main-content">{t('skip')}</a>
    <div className="top-bar">
      <div className="site-container top-bar-container">
        <div className="top-bar-left">
          <a href={`tel:${phone}`} className="top-bar-link" aria-label={`Phone: ${phone}`}>
            <Phone size={16} aria-hidden="true" />
            <span>{phone}</span>
          </a>
          <a href={`mailto:${email}`} className="top-bar-link" aria-label={`Email: ${email}`}>
            <Mail size={16} aria-hidden="true" />
            <span>{email}</span>
          </a>
        </div>
        <div className="top-bar-right">
          <div className="top-bar-socials" aria-label="Social media">
            <a href="https://www.linkedin.com" target="_blank" rel="noopener noreferrer" aria-label="LinkedIn" className="top-bar-social-link">
              <Linkedin size={17} aria-hidden="true" />
            </a>
            <a href="https://twitter.com" target="_blank" rel="noopener noreferrer" aria-label="Twitter" className="top-bar-social-link">
              <Twitter size={17} aria-hidden="true" />
            </a>
            <a href="https://www.facebook.com" target="_blank" rel="noopener noreferrer" aria-label="Facebook" className="top-bar-social-link">
              <Facebook size={17} aria-hidden="true" />
            </a>
            <a href="https://www.instagram.com" target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="top-bar-social-link">
              <Instagram size={17} aria-hidden="true" />
            </a>
          </div>
          <div className="top-bar-auth">
            <Link href="/admin/login" className="top-bar-auth-btn top-bar-login-btn">
              <LogIn size={15} aria-hidden="true" />
              <span>Login</span>
            </Link>
            <button type="button" onClick={onQuickQuote} className="top-bar-auth-btn top-bar-register-btn">
              <UserPlus size={15} aria-hidden="true" />
              <span>Register</span>
            </button>
          </div>
        </div>
      </div>
    </div>
    <header className="site-header">
      <div className="site-container header-main">
        <Link href={`/${locale}`} className="brand" aria-label="MedAxis Global Pharma">
          <Image src="/images/medaxis-logo.png" alt="MedAxis Global Pharma" width={818} height={196} unoptimized priority className="brand-logo" />
        </Link>
        <nav ref={navRef} className="desktop-nav" aria-label={t('navigation')}>
          <Link href={`/${locale}`} className="nav-link" aria-current={isRouteActive('') ? 'page' : undefined}>
            {t('home')}
          </Link>
          {dropdownGroups.map((group) => {
            const expanded = openMenu === group.id;
            return (
              <div
                key={group.id}
                className="nav-dropdown"
                data-open={expanded ? 'true' : undefined}
                onMouseEnter={() => setOpenMenu(group.id)}
                onMouseLeave={() => setOpenMenu((current) => (current === group.id ? null : current))}
              >
                <button
                  type="button"
                  className="nav-trigger"
                  aria-expanded={expanded}
                  aria-haspopup="true"
                  aria-current={isGroupActive(group.id) ? 'page' : undefined}
                  onClick={() => setOpenMenu(expanded ? null : group.id)}
                >
                  <span>{group.label}</span>
                  <ChevronDown size={15} className="nav-chevron" aria-hidden="true" />
                </button>
                {expanded && (
                  <div className={`nav-menu${group.heading ? ' nav-menu-wide' : ''}`}>
                    {group.heading && <p className="nav-menu-heading">{group.heading}</p>}
                    {group.items.map(({ label, description, href, Icon }) => (
                      <Link key={href} href={href} className="nav-menu-item" onClick={() => setOpenMenu(null)}>
                        <span className="nav-menu-icon" aria-hidden="true"><Icon size={17} /></span>
                        <span className="nav-menu-text">
                          <span className="nav-menu-title">{label}</span>
                          {description && <span className="nav-menu-desc">{description}</span>}
                        </span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          <button type="button" className="nav-link nav-contact-btn" onClick={() => { setOpenMenu(null); onContact(); }}>
            {t('contact')}
          </button>
        </nav>
        <div className="header-preferences"><LocaleSwitcher /></div>
        <div className="header-tools">
          <button className="cart-button" aria-label={t('cartCount', { count: itemCount })} onClick={onCart} disabled={!hydrated}>
            <ShoppingBag size={21} /><span className="cart-badge" aria-live="polite">{itemCount}</span>
          </button>
          <button className="icon-button menu-button" aria-label={t('menu')} aria-expanded={menuOpen} aria-controls="mobile-navigation" onClick={() => setMenuOpen(!menuOpen)}>
            {menuOpen ? <X size={23} /> : <Menu size={23} />}
          </button>
        </div>
        <button className="button primary header-quote" onClick={onQuickQuote}>{t('quickQuote')}<ArrowRight size={17} /></button>
      </div>
      {menuOpen && (
        <nav className="mobile-nav site-container" id="mobile-navigation" aria-label={t('mobileNavigation')}>
          <Link href={`/${locale}`} className="mobile-nav-link" onClick={() => setMenuOpen(false)}>
            {t('home')}<ArrowRight size={17} />
          </Link>
          {dropdownGroups.map((group) => {
            const groupOpen = mobileOpenGroup === group.id;
            return (
              <div key={group.id} className="mobile-nav-group">
                <div className="mobile-nav-row">
                  <Link href={group.href} className="mobile-nav-link" onClick={() => setMenuOpen(false)}>
                    {group.label}
                  </Link>
                  <button
                    type="button"
                    className="mobile-nav-toggle"
                    aria-expanded={groupOpen}
                    aria-label={t('toggleSubmenu', { section: group.label })}
                    onClick={() => setMobileOpenGroup(groupOpen ? null : group.id)}
                  >
                    <ChevronDown size={18} className={groupOpen ? 'rotated' : undefined} aria-hidden="true" />
                  </button>
                </div>
                {groupOpen && (
                  <div className="mobile-nav-sub">
                    {group.heading && <p className="nav-menu-heading">{group.heading}</p>}
                    {group.items.map(({ label, description, href, Icon }) => (
                      <Link key={href} href={href} className="mobile-nav-sublink" onClick={() => setMenuOpen(false)}>
                        <Icon size={16} aria-hidden="true" />
                        <span>
                          <span>{label}</span>
                          {description && <span className="mobile-nav-desc">{description}</span>}
                        </span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          <button type="button" className="mobile-nav-contact" onClick={() => { setMenuOpen(false); onContact(); }}>
            {t('contact')}<ArrowRight size={17} />
          </button>
        </nav>
      )}
    </header>
  </>;
}
