/**
 * æ”¿åŠ¡çº§æ•°æ®è„±æ•æ¨¡å—
 * å¯¹æ•æ„Ÿæ•°æ®è¿›è¡Œè„±æ•å¤„ç†
 */

class DataMasking {
  constructor() {
    this.maskingRules = {
      phone: this.maskPhone.bind(this),
      email: this.maskEmail.bind(this),
      idCard: this.maskIdCard.bind(this),
      name: this.maskName.bind(this),
      address: this.maskAddress.bind(this),
      bankCard: this.maskBankCard.bind(this),
      password: this.maskPassword.bind(this),
    };
  }

  /**
   * è„±æ•æ‰‹æœºå·
   * @param {string} phone - æ‰‹æœºå·
   * @returns {string} è„±æ•åŽçš„æ‰‹æœºå·
   */
  maskPhone(phone) {
    if (!phone || typeof phone !== 'string') {
      return phone;
    }
    return phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
  }

  /**
   * è„±æ•é‚®ç®±
   * @param {string} email - é‚®ç®±
   * @returns {string} è„±æ•åŽçš„é‚®ç®±
   */
  maskEmail(email) {
    if (!email || typeof email !== 'string') {
      return email;
    }
    const [username, domain] = email.split('@');
    if (!username || !domain) {
      return email;
    }
    const maskedUsername =
      username.length > 2
        ? username.substring(0, 2) + '*'.repeat(username.length - 2)
        : username + '*';
    return `${maskedUsername}@${domain}`;
  }

  /**
   * è„±æ•èº«ä»½è¯å·
   * @param {string} idCard - èº«ä»½è¯å·
   * @returns {string} è„±æ•åŽçš„èº«ä»½è¯å·
   */
  maskIdCard(idCard) {
    if (!idCard || typeof idCard !== 'string') {
      return idCard;
    }
    if (idCard.length === 18) {
      return idCard.replace(/(\d{6})\d{8}(\d{4})/, '$1********$2');
    } else if (idCard.length === 15) {
      return idCard.replace(/(\d{6})\d{6}(\d{3})/, '$1******$2');
    }
    return idCard;
  }

  /**
   * è„±æ•å§“å
   * @param {string} name - å§“å
   * @returns {string} è„±æ•åŽçš„å§“å
   */
  maskName(name) {
    if (!name || typeof name !== 'string') {
      return name;
    }
    if (name.length <= 1) {
      return name;
    }
    if (name.length === 2) {
      return name.charAt(0) + '*';
    }
    return name.charAt(0) + '*'.repeat(name.length - 2) + name.charAt(name.length - 1);
  }

  /**
   * è„±æ•åœ°å€
   * @param {string} address - åœ°å€
   * @returns {string} è„±æ•åŽçš„åœ°å€
   */
  maskAddress(address) {
    if (!address || typeof address !== 'string') {
      return address;
    }
    if (address.length <= 6) {
      return address;
    }
    const showLength = Math.floor(address.length / 3);
    return (
      address.substring(0, showLength) +
      '*'.repeat(address.length - showLength * 2) +
      address.substring(address.length - showLength)
    );
  }

  /**
   * è„±æ•é“¶è¡Œå¡å·
   * @param {string} bankCard - é“¶è¡Œå¡å·
   * @returns {string} è„±æ•åŽçš„é“¶è¡Œå¡å·
   */
  maskBankCard(bankCard) {
    if (!bankCard || typeof bankCard !== 'string') {
      return bankCard;
    }
    if (bankCard.length <= 8) {
      return bankCard;
    }
    return (
      bankCard.substring(0, 4) +
      '*'.repeat(bankCard.length - 8) +
      bankCard.substring(bankCard.length - 4)
    );
  }

  /**
   * è„±æ•å¯†ç 
   * @param {string} password - å¯†ç 
   * @returns {string} è„±æ•åŽçš„å¯†ç 
   */
  maskPassword(password) {
    if (!password) {
      return password;
    }
    return '******';
  }

  /**
   * æ ¹æ®ç±»åž‹è‡ªåŠ¨è„±æ•
   * @param {string} data - æ•°æ®
   * @param {string} type - æ•°æ®ç±»åž‹
   * @returns {string} è„±æ•åŽçš„æ•°æ®
   */
  mask(data, type) {
    const masker = this.maskingRules[type];
    if (masker) {
      return masker(data);
    }
    return data;
  }

  /**
   * æ‰¹é‡è„±æ•å¯¹è±¡
   * @param {Object} obj - å¯¹è±¡
   * @param {Object} fieldTypes - å­—æ®µç±»åž‹æ˜ å°„ { fieldName: dataType }
   * @returns {Object} è„±æ•åŽçš„å¯¹è±¡
   */
  maskObject(obj, fieldTypes) {
    if (!obj || typeof obj !== 'object') {
      return obj;
    }

    const result = Array.isArray(obj) ? [] : {};

    for (const [key, value] of Object.entries(obj)) {
      if (value && typeof value === 'object') {
        result[key] = this.maskObject(value, fieldTypes);
      } else {
        const type = fieldTypes[key];
        result[key] = type ? this.mask(value, type) : value;
      }
    }

    return result;
  }

  /**
   * è‡ªåŠ¨è¯†åˆ«å¹¶è„±æ•
   * @param {string} data - æ•°æ®
   * @returns {string} è„±æ•åŽçš„æ•°æ®
   */
  autoMask(data) {
    if (!data || typeof data !== 'string') {
      return data;
    }

    if (/^1[3-9]\d{9}$/.test(data)) {
      return this.maskPhone(data);
    }

    if (/^[\w.-]+@[\w.-]+\.\w+$/.test(data)) {
      return this.maskEmail(data);
    }

    if (/(^\d{15}$)|(^\d{18}$)|(^\d{17}(\d|X|x)$)/.test(data)) {
      return this.maskIdCard(data);
    }

    if (/^\d{16,19}$/.test(data)) {
      return this.maskBankCard(data);
    }

    return data;
  }

  /**
   * æ—¥å¿—è„±æ•
   * @param {string|Object} log - æ—¥å¿—å†…å®¹
   * @returns {string|Object} è„±æ•åŽçš„æ—¥å¿—
   */
  maskLog(log) {
    if (typeof log === 'string') {
      let masked = log;
      masked = masked.replace(/1[3-9]\d{9}/g, (match) => this.maskPhone(match));
      masked = masked.replace(/[\w.-]+@[\w.-]+\.\w+/g, (match) => this.maskEmail(match));
      return masked;
    }

    if (typeof log === 'object' && log !== null) {
      return this.maskObject(log, {});
    }

    return log;
  }
}

module.exports = new DataMasking();
