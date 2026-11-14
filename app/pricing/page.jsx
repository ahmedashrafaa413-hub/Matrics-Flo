"use client";

import { useMemo, useState } from "react";
import { useLanguage } from "../context/LanguageContext";

const COPY = {
  ar: {
    eyebrow: "خطط بسيطة وواضحة",
    title: "اختر الباقة المناسبة لنموك",
    subtitle: "ابدأ مجانًا، ثم انتقل إلى الباقة التي تناسب فريقك وحجم حساباتك الإعلانية.",
    monthly: "شهري", annual: "سنوي", freeMonths: "وفر شهرين",
    promoPlaceholder: "أدخل كود الخصم", apply: "تطبيق",
    promoNotice: "سيتم التحقق من أكواد الخصم عند تفعيل بوابة الدفع.",
    month: "شهر", billedAnnually: "تُدفع سنويًا", current: "باقتك الحالية",
    start: "ابدأ الآن", choose: "اختر الباقة", contact: "تواصل معنا",
    actionNotice: "تم حفظ اختيارك مبدئيًا. إتمام الاشتراك سيكون متاحًا فور تفعيل بوابة الدفع.",
    popular: "الأكثر شعبية", trial: "متبقي 6 أيام في التجربة المجانية",
    custom: "مخصص", customPrice: "تواصل معنا للحصول على عرض يناسب احتياجاتك",
    plans: {
      Free: "مجانية", Solo: "فردية", Growth: "النمو", Agency: "الوكالات", Enterprise: "المؤسسات"
    },
    features: {
      seats: (n) => `${n} ${n === 1 ? "مستخدم" : "مستخدمين"}`,
      workspaces: (n) => `${n} مساحات عمل للعلامات التجارية`,
      accounts: (n) => `${n} حسابًا إعلانيًا`,
      dashboards: "لوحات معلومات غير محدودة", refresh12: "تحديث البيانات كل 12 ساعة",
      refresh6: "تحديث البيانات كل 6 ساعات", refresh1: "تحديث البيانات كل ساعة",
      history3m: "سجل بيانات لمدة 3 أشهر", history1y: "سجل بيانات لمدة سنة",
      history3y: "سجل بيانات لمدة 3 سنوات", history5y: "سجل بيانات لمدة 5 سنوات",
      ai1000: "1,000 رصيد ذكاء اصطناعي شهريًا", ai3000: "3,000 رصيد ذكاء اصطناعي شهريًا",
      aiTrial: "+100 رصيد خلال التجربة المجانية", noAi: "بدون مساعد ذكاء اصطناعي",
      manageAi: "إدارة الإعلانات من Claude أو ChatGPT", customLimits: "حدود مخصصة حسب احتياجك",
      onboarding: "تهيئة وتدريب مخصصان", support: "دعم فني بأولوية"
    }
  },
  en: {
    eyebrow: "Simple, transparent plans", title: "Choose the plan that fits your growth",
    subtitle: "Start free, then upgrade when your team and advertising accounts are ready.",
    monthly: "Monthly", annual: "Annual", freeMonths: "2 months free",
    promoPlaceholder: "Enter promo code", apply: "Apply",
    promoNotice: "Promo codes will be validated when the payment gateway is enabled.",
    month: "month", billedAnnually: "billed annually", current: "Current plan",
    start: "Get started", choose: "Choose plan", contact: "Contact us",
    actionNotice: "Your choice has been saved for now. Checkout will be available when payments are enabled.",
    popular: "Most popular", trial: "6 days left in your free trial", custom: "Custom",
    customPrice: "Contact us for a plan tailored to your needs",
    plans: { Free: "Free", Solo: "Solo", Growth: "Growth", Agency: "Agency", Enterprise: "Enterprise" },
    features: {
      seats: (n) => `${n} seat${n === 1 ? "" : "s"}`, workspaces: (n) => `${n} brand workspaces`,
      accounts: (n) => `${n} ad accounts`, dashboards: "Unlimited dashboards", refresh12: "12-hour refresh",
      refresh6: "6-hour refresh", refresh1: "Hourly refresh", history3m: "3 months history",
      history1y: "1 year history", history3y: "3 years history", history5y: "5 years history",
      ai1000: "1,000 AI credits/month", ai3000: "3,000 AI credits/month",
      aiTrial: "+100 credits during free trial", noAi: "No AI assistant",
      manageAi: "Manage ads from Claude or ChatGPT", customLimits: "Custom limits for your needs",
      onboarding: "Dedicated onboarding and training", support: "Priority support"
    }
  }
};

function createPlans(text) {
  const f = text.features;
  return [
    { id:"Free", monthly:0, features:[f.seats(3),f.workspaces(10),f.accounts(50),f.dashboards,f.refresh12,f.history3m,f.ai1000], current:true },
    { id:"Solo", monthly:990, features:[f.seats(1),f.workspaces(3),f.accounts(15),f.dashboards,f.refresh12,f.history1y,f.noAi] },
    { id:"Growth", monthly:2490, features:[f.seats(3),f.workspaces(10),f.accounts(50),f.dashboards,f.refresh6,f.history3y,f.ai1000,f.aiTrial,f.manageAi], popular:true, trial:true },
    { id:"Agency", monthly:4990, features:[f.seats(10),f.workspaces(30),f.accounts(150),f.dashboards,f.refresh1,f.history5y,f.ai3000,f.manageAi] },
    { id:"Enterprise", monthly:null, features:[f.customLimits,f.dashboards,f.onboarding,f.support] }
  ];
}

function Price({ plan, annual, text, locale }) {
  if (plan.monthly === null) return <div className="pricing-custom-price"><strong>{text.custom}</strong><span>{text.customPrice}</span></div>;
  const monthly = annual ? Math.round(plan.monthly * 10 / 12) : plan.monthly;
  const formatted = new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-US").format(monthly);
  return <div className="pricing-price"><span>EGP</span><strong>{formatted}</strong><small>/ {text.month}</small>{annual && plan.monthly > 0 && <em>EGP {new Intl.NumberFormat("en-US").format(plan.monthly * 10)} {text.billedAnnually}</em>}</div>;
}

export default function PricingPage() {
  const { locale } = useLanguage();
  const text = COPY[locale] || COPY.ar;
  const [annual, setAnnual] = useState(false);
  const [promo, setPromo] = useState("");
  const [notice, setNotice] = useState("");
  const plans = useMemo(() => createPlans(text), [text]);

  function choosePlan(plan) {
    setNotice(plan.id === "Enterprise" ? text.customPrice : text.actionNotice);
  }

  return <main className="pricing-page">
    <header className="pricing-hero">
      <span>{text.eyebrow}</span><h1>{text.title}</h1><p>{text.subtitle}</p>
      <div className="pricing-controls">
        <div className="billing-toggle" role="group" aria-label={text.title}>
          <button type="button" className={!annual ? "active" : ""} aria-pressed={!annual} onClick={() => setAnnual(false)}>{text.monthly}</button>
          <button type="button" className={annual ? "active" : ""} aria-pressed={annual} onClick={() => setAnnual(true)}>{text.annual}<b>{text.freeMonths}</b></button>
        </div>
        <form className="promo-form" onSubmit={(event) => { event.preventDefault(); setNotice(text.promoNotice); }}>
          <label className="sr-only" htmlFor="promo-code">{text.promoPlaceholder}</label>
          <input id="promo-code" value={promo} onChange={(event) => setPromo(event.target.value)} placeholder={text.promoPlaceholder} />
          <button type="submit" disabled={!promo.trim()}>{text.apply}</button>
        </form>
      </div>
      {notice && <p className="pricing-notice" role="status">{notice}</p>}
    </header>
    <section className="pricing-grid" aria-label={text.title}>
      {plans.map((plan) => <article className={`pricing-card${plan.popular ? " featured" : ""}`} key={plan.id}>
        {plan.popular && <div className="pricing-popular">{text.popular}</div>}
        <div className="pricing-card-head"><h2>{text.plans[plan.id]}</h2>{plan.trial && <span>{text.trial}</span>}</div>
        <Price plan={plan} annual={annual} text={text} locale={locale} />
        <button type="button" className="pricing-cta" disabled={plan.current} onClick={() => choosePlan(plan)}>{plan.current ? text.current : plan.id === "Enterprise" ? text.contact : plan.id === "Free" ? text.start : text.choose}</button>
        <ul>{plan.features.map((feature) => <li key={feature}><span aria-hidden="true">✓</span>{feature}</li>)}</ul>
      </article>)}
    </section>
  </main>;
}
