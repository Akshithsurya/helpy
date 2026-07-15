class ClassificationEngine {
  constructor() {
    this.categories = [];
    this.customPatterns = {};
    this.init();
  }

  async init() {
    try {
      const result = await chrome.storage.sync.get(['categories', 'customPatterns']);
      if (result.categories) {
        this.categories = result.categories;
      } else {
        const response = await fetch(chrome.runtime.getURL('categories.json'));
        const data = await response.json();
        this.categories = data.categories;
        await chrome.storage.sync.set({ categories: this.categories });
      }
      this.customPatterns = result.customPatterns || {};
    } catch (error) {
      console.error('Failed to initialize classification engine:', error);
      this.categories = [];
    }
  }

  async reloadCategories() {
    const result = await chrome.storage.sync.get(['categories', 'customPatterns']);
    if (result.categories) {
      this.categories = result.categories;
    }
    this.customPatterns = result.customPatterns || {};
  }

  extractDomain(url) {
    try {
      if (!url) return null;
      if (url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
        return null;
      }
      const urlObj = new URL(url);
      return urlObj.hostname.replace(/^www\./, '');
    } catch {
      return null;
    }
  }

  classifyUrl(url) {
    const domain = this.extractDomain(url);
    if (!domain) return null;

    for (const category of this.categories) {
      for (const pattern of category.patterns) {
        if (this.matchPattern(domain, url, pattern)) {
          return {
            id: category.id,
            name: category.name,
            color: category.color,
          };
        }
      }
    }

    for (const [categoryId, patterns] of Object.entries(this.customPatterns)) {
      for (const pattern of patterns) {
        if (this.matchPattern(domain, url, pattern)) {
          const category = this.categories.find((c) => c.id === categoryId);
          if (category) {
            return {
              id: category.id,
              name: category.name,
              color: category.color,
            };
          }
        }
      }
    }

    return null;
  }

  matchPattern(domain, fullUrl, pattern) {
    if (fullUrl.includes(pattern)) {
      return true;
    }
    if (domain === pattern) {
      return true;
    }
    if (domain.endsWith('.' + pattern)) {
      return true;
    }
    const regexPattern = pattern.replace(/\*/g, '.*');
    try {
      const regex = new RegExp(regexPattern);
      if (regex.test(fullUrl) || regex.test(domain)) {
        return true;
      }
    } catch {}
    return false;
  }

  getCategories() {
    return this.categories;
  }

  async addCustomPattern(categoryId, pattern) {
    if (!this.customPatterns[categoryId]) {
      this.customPatterns[categoryId] = [];
    }
    if (!this.customPatterns[categoryId].includes(pattern)) {
      this.customPatterns[categoryId].push(pattern);
      await chrome.storage.sync.set({ customPatterns: this.customPatterns });
    }
  }

  async removeCustomPattern(categoryId, pattern) {
    if (this.customPatterns[categoryId]) {
      this.customPatterns[categoryId] = this.customPatterns[categoryId].filter(
        (p) => p !== pattern
      );
      await chrome.storage.sync.set({ customPatterns: this.customPatterns });
    }
  }

  async addCategory(category) {
    this.categories.push(category);
    await chrome.storage.sync.set({ categories: this.categories });
  }

  async updateCategory(categoryId, updates) {
    const index = this.categories.findIndex((c) => c.id === categoryId);
    if (index !== -1) {
      this.categories[index] = { ...this.categories[index], ...updates };
      await chrome.storage.sync.set({ categories: this.categories });
    }
  }

  async deleteCategory(categoryId) {
    this.categories = this.categories.filter((c) => c.id !== categoryId);
    delete this.customPatterns[categoryId];
    await chrome.storage.sync.set({
      categories: this.categories,
      customPatterns: this.customPatterns,
    });
  }
}

if (typeof module !== 'undefined') {
  module.exports = ClassificationEngine;
}
