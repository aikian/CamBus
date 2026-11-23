// The private on-disk snapshot contains marginal counts and independent receipts for this month.
const fs = require('node:fs');
const crypto = require('node:crypto');

const categories = {
  ageBand: ['14~19세', '20대', '30대', '40대', '50대', '60세 이상'],
  gender: ['여성', '남성', '기타', '응답하지 않음'],
  occupation: ['학생', '교수·강사', '연구원', '교직원', '직장인', '자영업·프리랜서', '구직 중', '기타']
};

function openAudience(file, currentMonth) {
  let data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8'))
    : { receiptMonth: currentMonth(), receipts: {}, months: {} };

  function save(next) {
    fs.writeFileSync(file + '.tmp', JSON.stringify(next), { mode: 0o600 });
    fs.renameSync(file + '.tmp', file);
    data = next;
  }

  function rotate() {
    const month = currentMonth();
    if (data.receiptMonth !== month) {
      const [year, number] = month.split('-').map(Number);
      const oldest = new Date(Date.UTC(year, number - 12, 1)).toISOString().slice(0, 7);
      const months = Object.fromEntries(Object.entries(data.months).filter(([key]) => key >= oldest && key <= month));
      save({ receiptMonth: month, receipts: {}, months });
    }
    return month;
  }

  function record(body) {
    const month = rotate();
    if (!body || typeof body !== 'object' || Object.keys(body).length !== 5 ||
        typeof body.receipt !== 'string' || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(body.receipt) ||
        !Object.entries(categories).every(([field, values]) => values.includes(body[field]))) return 400;
    if (body.month !== month) return 409;
    const key = crypto.createHash('sha256').update(body.receipt.toLowerCase()).digest('hex');
    if (data.receipts[key]) return 200;
    const row = data.months[month] || { total: 0, ageBand: {}, gender: {}, occupation: {} };
    const next = { total: row.total + 1 };
    for (const field of Object.keys(categories)) {
      const value = body[field];
      next[field] = { ...row[field], [value]: (row[field][value] || 0) + 1 };
    }
    save({ receiptMonth: month, receipts: { ...data.receipts, [key]: true }, months: { ...data.months, [month]: next } });
    return 200;
  }

  rotate();
  return { record, rotate, summary() { rotate(); return data.months; } };
}

module.exports = { openAudience };
