const path = require('path');
const fs = require('fs');
const Store = require('electron-store');

class I18n {
  constructor() {
    this.store = new Store();
    this.currentLang = this.store.get('language', 'en');
    this.translations = {};
    this.supportedLanguages = ['en', 'zh-CN', 'es', 'fr', 'de', 'ja'];
    this.languageNames = {
      en: 'English',
      'zh-CN': '中文 (简体)',
      es: 'Español',
      fr: 'Français',
      de: 'Deutsch',
      ja: '日本語',
    };

    this.loadAllTranslations();
  }

  loadAllTranslations() {
    this.supportedLanguages.forEach((lang) => {
      try {
        const filePath = path.join(__dirname, 'locales', `${lang}.json`);
        this.translations[lang] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (error) {
        console.warn(`Failed to load translations for ${lang}:`, error.message);
        this.translations[lang] = {};
      }
    });
  }

  setLanguage(lang) {
    if (this.supportedLanguages.includes(lang)) {
      this.currentLang = lang;
      this.store.set('language', lang);
      return true;
    }
    console.warn(`Language ${lang} not supported, falling back to English`);
    this.currentLang = 'en';
    this.store.set('language', 'en');
    return false;
  }

  getLanguage() {
    return this.currentLang;
  }

  getSupportedLanguages() {
    return this.supportedLanguages.map((code) => ({
      code,
      name: this.languageNames[code],
    }));
  }

  t(key, params = {}) {
    // Helper function to get nested value using dot notation
    const getNestedValue = (obj, path) => {
      return path.split('.').reduce((current, part) => {
        return current && current[part];
      }, obj);
    };

    let translation = getNestedValue(this.translations[this.currentLang], key);

    if (!translation) {
      translation = getNestedValue(this.translations['en'], key);
    }

    if (!translation) {
      return key;
    }

    return this.interpolate(translation, params);
  }

  interpolate(str, params) {
    return str.replace(/\{(\w+)\}/g, (match, key) => {
      return params[key] !== undefined ? params[key] : match;
    });
  }

  formatDate(date, locale = this.currentLang) {
    try {
      const d = new Date(date);
      return new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(d);
    } catch (error) {
      return date;
    }
  }

  getPresetTranslation(presetName, key) {
    const presetKey = `presets.${presetName}.${key}`;
    return this.t(presetKey);
  }
}

const i18nInstance = new I18n();
module.exports = i18nInstance;
