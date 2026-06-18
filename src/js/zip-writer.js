/**
 * 轻量级 ZIP 打包工具（Store-only 模式）
 *
 * 仅实现 ZIP 的"存储"模式（不压缩），生成符合 PKZip 规范的 .zip 文件。
 * 优势：
 *   - 零依赖，纯 JS 实现
 *   - 对于已是压缩格式的图片（JPEG/PNG/WebP），Store 模式比 Deflate 更快
 *   - 输出文件浏览器可直接识别
 *
 * 限制：
 *   - 仅支持 Store（method=0），不进行再压缩
 *   - 文件名使用 UTF-8 编码，启用 General Purpose Bit Flag bit 11
 *   - 32 位大小限制（单文件 ≤ 4GB），完全够用
 *
 * 参考规范：PKWARE APPNOTE.TXT 6.3.10
 */

/**
 * 将字符串以 UTF-8 编码写入 DataView
 * @param {DataView} view 目标视图
 * @param {number} offset 起始偏移
 * @param {string} str 待写入字符串
 * @returns {number} 写入的字节数
 */
function writeUtf8(view, offset, str) {
    const bytes = new TextEncoder().encode(str);
    for (let i = 0; i < bytes.length; i++) {
        view.setUint8(offset + i, bytes[i]);
    }
    return bytes.length;
}

/**
 * 计算字符串的 UTF-8 字节长度
 * @param {string} str
 * @returns {number}
 */
function utf8ByteLength(str) {
    return new TextEncoder().encode(str).length;
}

/**
 * CRC-32 校验和（ZIP 标准使用 IEEE 802.3 多项式 0xEDB88320）
 * @param {Uint8Array} bytes
 * @returns {number} CRC-32 值（低 32 位）
 */
const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[i] = c >>> 0;
    }
    return table;
})();

/**
 * 计算 CRC-32 校验和
 * @param {Uint8Array} bytes
 * @returns {number}
 */
function crc32(bytes) {
    let crc = 0xffffffff;
    const table = CRC_TABLE;
    for (let i = 0; i < bytes.length; i++) {
        crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 0xff];
    }
    return (crc ^ 0xffffffff) >>> 0;
}

/**
 * 将毫秒时间戳转为 DOS 日期/时间格式
 * @param {Date} date
 * @returns {{date: number, time: number}}
 */
function dosDateTime(date) {
    // DOS 时间：bits 0-4 秒/2，5-10 分，11-15 时
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2));
    // DOS 日期：bits 0-4 日，5-8 月，9-15 年(自1980)
    const year = Math.max(date.getFullYear() - 1980, 0);
    const dosDate = (year << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { date: dosDate, time };
}

/**
 * 创建包含指定文件的 ZIP Blob
 * @param {Array<{name: string, blob: Blob}>} files 文件列表
 * @returns {Promise<Blob>} ZIP 格式 Blob
 */
export async function createZip(files) {
    const now = new Date();
    const { date: dosDate, time: dosTime } = dosDateTime(now);

    // 收集所有文件的原始字节
    const fileEntries = await Promise.all(
        files.map(async ({ name, blob }) => {
            const data = new Uint8Array(await blob.arrayBuffer());
            return { name, data, crc: crc32(data) };
        })
    );

    // Local file header 单条固定 30 字节 + 文件名 UTF-8 字节
    const localHeaderSize = 30;
    // Central directory header 单条固定 46 字节
    const cdHeaderSize = 46;
    // End of central directory record 固定 22 字节
    const eocdSize = 22;

    let localPartSize = 0;
    let cdPartSize = 0;
    for (const f of fileEntries) {
        const nameBytes = utf8ByteLength(f.name);
        localPartSize += localHeaderSize + nameBytes + f.data.length;
        cdPartSize += cdHeaderSize + nameBytes;
    }

    const totalSize = localPartSize + cdPartSize + eocdSize;
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    const u8 = new Uint8Array(buffer);

    let localOffset = 0;
    let cdOffset = 0;
    const cdStart = localPartSize;

    for (const f of fileEntries) {
        const nameBytes = utf8ByteLength(f.name);

        // ----- Local file header (30 + name) -----
        view.setUint32(localOffset, 0x04034b50, true);          // signature
        view.setUint16(localOffset + 4, 20, true);              // version needed
        view.setUint16(localOffset + 6, 0x0800, true);          // flags: UTF-8 filename
        view.setUint16(localOffset + 8, 0, true);               // method: store
        view.setUint16(localOffset + 10, dosTime, true);        // mod time
        view.setUint16(localOffset + 12, dosDate, true);        // mod date
        view.setUint32(localOffset + 14, f.crc, true);          // CRC-32
        view.setUint32(localOffset + 18, f.data.length, true);  // compressed size
        view.setUint32(localOffset + 22, f.data.length, true);  // uncompressed size
        view.setUint16(localOffset + 26, nameBytes, true);      // file name length
        view.setUint16(localOffset + 28, 0, true);              // extra field length
        writeUtf8(view, localOffset + 30, f.name);              // file name
        u8.set(f.data, localOffset + 30 + nameBytes);           // file data

        // ----- Central directory header (46 + name) -----
        const cdPtr = cdStart + cdOffset;
        view.setUint32(cdPtr, 0x02014b50, true);                // signature
        view.setUint16(cdPtr + 4, 20, true);                    // version made by
        view.setUint16(cdPtr + 6, 20, true);                    // version needed
        view.setUint16(cdPtr + 8, 0x0800, true);                // flags: UTF-8 filename
        view.setUint16(cdPtr + 10, 0, true);                    // method: store
        view.setUint16(cdPtr + 12, dosTime, true);              // mod time
        view.setUint16(cdPtr + 14, dosDate, true);              // mod date
        view.setUint32(cdPtr + 16, f.crc, true);                // CRC-32
        view.setUint32(cdPtr + 20, f.data.length, true);        // compressed size
        view.setUint32(cdPtr + 24, f.data.length, true);        // uncompressed size
        view.setUint16(cdPtr + 28, nameBytes, true);            // file name length
        view.setUint16(cdPtr + 30, 0, true);                    // extra field length
        view.setUint16(cdPtr + 32, 0, true);                    // file comment length
        view.setUint16(cdPtr + 34, 0, true);                    // disk number
        view.setUint16(cdPtr + 36, 0, true);                    // internal attrs
        view.setUint32(cdPtr + 38, 0, true);                    // external attrs
        view.setUint32(cdPtr + 42, localOffset, true);          // local header offset
        writeUtf8(view, cdPtr + 46, f.name);                    // file name

        localOffset += localHeaderSize + nameBytes + f.data.length;
        cdOffset += cdHeaderSize + nameBytes;
    }

    // ----- End of central directory record (22 bytes) -----
    const eocdPtr = localPartSize + cdPartSize;
    view.setUint32(eocdPtr, 0x06054b50, true);                 // signature
    view.setUint16(eocdPtr + 4, 0, true);                      // disk number
    view.setUint16(eocdPtr + 6, 0, true);                      // disk where CD starts
    view.setUint16(eocdPtr + 8, fileEntries.length, true);     // # entries on this disk
    view.setUint16(eocdPtr + 10, fileEntries.length, true);    // # total entries
    view.setUint32(eocdPtr + 12, cdPartSize, true);            // CD size
    view.setUint32(eocdPtr + 16, cdStart, true);                // CD offset
    view.setUint16(eocdPtr + 20, 0, true);                     // comment length

    return new Blob([buffer], { type: 'application/zip' });
}
