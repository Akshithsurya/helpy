/**
 * 政务级加密工具模块
 * 提供 AES-256 加密、哈希生成、密钥管理等功能
 */

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM 推荐使用 12 字节 IV
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32; // 256 位

class CryptoUtils {
  constructor() {
    this.masterKey = null;
    this.keyPath = path.join(__dirname, '..', '.keys', 'master.key');
    this.ensureKeyDirectory();
  }

  /**
   * 确保密钥目录存在
   */
  ensureKeyDirectory() {
    const keyDir = path.dirname(this.keyPath);
    if (!fs.existsSync(keyDir)) {
      fs.mkdirSync(keyDir, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * 获取或生成主密钥
   */
  getMasterKey() {
    if (this.masterKey) {
      return this.masterKey;
    }

    if (fs.existsSync(this.keyPath)) {
      const keyData = fs.readFileSync(this.keyPath);
      this.masterKey = Buffer.from(keyData);
    } else {
      this.masterKey = crypto.randomBytes(KEY_LENGTH);
      fs.writeFileSync(this.keyPath, this.masterKey, { mode: 0o600 });
    }

    return this.masterKey;
  }

  /**
   * 使用密码派生密钥
   * @param {string} password - 用户密码
   * @param {Buffer} salt - 盐值
   * @returns {Buffer} 派生的密钥
   */
  deriveKey(password, salt) {
    return crypto.pbkdf2Sync(password, salt, 100000, KEY_LENGTH, 'sha256');
  }

  /**
   * AES-256-GCM 加密
   * @param {string|Buffer} plaintext - 明文
   * @param {Buffer} [key] - 加密密钥（可选，默认使用主密钥）
   * @returns {string} 加密后的密文（Base64 编码）
   */
  encrypt(plaintext, key = null) {
    const encryptionKey = key || this.getMasterKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const salt = crypto.randomBytes(SALT_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(Buffer.from(JSON.stringify(plaintext))),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    const result = Buffer.concat([salt, iv, tag, encrypted]);
    return result.toString('base64');
  }

  /**
   * AES-256-GCM 解密
   * @param {string} ciphertext - 密文（Base64 编码）
   * @param {Buffer} [key] - 解密密钥（可选，默认使用主密钥）
   * @returns {any} 解密后的明文
   */
  decrypt(ciphertext, key = null) {
    const decryptionKey = key || this.getMasterKey();
    const data = Buffer.from(ciphertext, 'base64');

    const salt = data.slice(0, SALT_LENGTH);
    const iv = data.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const tag = data.slice(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
    const encrypted = data.slice(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, decryptionKey, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

    return JSON.parse(decrypted.toString());
  }

  /**
   * 生成安全哈希
   * @param {string|Buffer} data - 数据
   * @param {string} algorithm - 哈希算法
   * @returns {string} 哈希值（十六进制）
   */
  hash(data, algorithm = 'sha256') {
    return crypto
      .createHash(algorithm)
      .update(Buffer.from(JSON.stringify(data)))
      .digest('hex');
  }

  /**
   * 生成带盐的哈希（用于密码存储）
   * @param {string} password - 密码
   * @returns {string} 带盐的哈希
   */
  hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha256').toString('hex');
    return `${salt}:${hash}`;
  }

  /**
   * 验证密码
   * @param {string} password - 待验证的密码
   * @param {string} storedHash - 存储的哈希值
   * @returns {boolean} 是否匹配
   */
  verifyPassword(password, storedHash) {
    const [salt, hash] = storedHash.split(':');
    const computedHash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha256').toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(computedHash));
  }

  /**
   * 生成 HMAC 签名
   * @param {string|Buffer} data - 数据
   * @param {string|Buffer} secret - 密钥
   * @returns {string} HMAC 签名
   */
  hmac(data, secret) {
    return crypto
      .createHmac('sha256', secret)
      .update(Buffer.from(JSON.stringify(data)))
      .digest('hex');
  }

  /**
   * 验证 HMAC 签名
   * @param {string|Buffer} data - 数据
   * @param {string} signature - 签名
   * @param {string|Buffer} secret - 密钥
   * @returns {boolean} 是否有效
   */
  verifyHmac(data, signature, secret) {
    const expected = this.hmac(data, secret);
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  }

  /**
   * 生成安全随机 ID
   * @param {number} length - ID 长度
   * @returns {string} 随机 ID
   */
  generateSecureId(length = 32) {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * 加密文件
   * @param {string} inputPath - 输入文件路径
   * @param {string} outputPath - 输出文件路径
   * @param {Buffer} [key] - 加密密钥
   */
  encryptFile(inputPath, outputPath, key = null) {
    const encryptionKey = key || this.getMasterKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const salt = crypto.randomBytes(SALT_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey, iv);
    const input = fs.createReadStream(inputPath);
    const output = fs.createWriteStream(outputPath);

    output.write(salt);
    output.write(iv);

    input.pipe(cipher).pipe(output);

    cipher.on('end', () => {
      output.write(cipher.getAuthTag());
    });
  }

  /**
   * 解密文件
   * @param {string} inputPath - 输入文件路径
   * @param {string} outputPath - 输出文件路径
   * @param {Buffer} [key] - 解密密钥
   */
  decryptFile(inputPath, outputPath, key = null) {
    const decryptionKey = key || this.getMasterKey();
    const fileSize = fs.statSync(inputPath).size;
    const tagPosition = fileSize - TAG_LENGTH;

    const fd = fs.openSync(inputPath, 'r');
    const salt = Buffer.alloc(SALT_LENGTH);
    const iv = Buffer.alloc(IV_LENGTH);
    const tag = Buffer.alloc(TAG_LENGTH);

    fs.readSync(fd, salt, 0, SALT_LENGTH, 0);
    fs.readSync(fd, iv, 0, IV_LENGTH, SALT_LENGTH);
    fs.readSync(fd, tag, 0, TAG_LENGTH, tagPosition);
    fs.closeSync(fd);

    const decipher = crypto.createDecipheriv(ALGORITHM, decryptionKey, iv);
    decipher.setAuthTag(tag);

    const input = fs.createReadStream(inputPath, {
      start: SALT_LENGTH + IV_LENGTH,
      end: tagPosition - 1,
    });
    const output = fs.createWriteStream(outputPath);

    input.pipe(decipher).pipe(output);
  }
}

module.exports = new CryptoUtils();
