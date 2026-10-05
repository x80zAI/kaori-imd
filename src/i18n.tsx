import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Language = 'en' | 'zh';
export type Translate = (english: string, chinese: string) => string;
const LANGUAGE_KEY = 'kaori-language-v1';
const LanguageContext = createContext<{ language: Language; setLanguage: (language: Language) => void; t: Translate; locale: string } | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => {
    try { return localStorage.getItem(LANGUAGE_KEY) === 'zh' ? 'zh' : 'en'; } catch { return 'en'; }
  });
  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    try { localStorage.setItem(LANGUAGE_KEY, language); } catch { /* The selection still applies for this visit. */ }
  }, [language]);
  const t = useCallback<Translate>((english, chinese) => language === 'zh' ? chinese : english, [language]);
  const value = useMemo(() => ({ language, setLanguage, t, locale: language === 'zh' ? 'zh-CN' : 'en-GB' }), [language, t]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('LanguageProvider is required.');
  return context;
}
