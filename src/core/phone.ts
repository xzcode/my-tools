import { getCountries, getCountryCallingCode, parsePhoneNumberFromString, validatePhoneNumberLength } from 'libphonenumber-js/max';
import type { CountryCode } from 'libphonenumber-js';
import type { ToolRequest, ToolResult } from './types';

const names = new Intl.DisplayNames(['zh-CN'], { type: 'region' });
const english = new Intl.DisplayNames(['en'], { type: 'region' });
export const phoneCountries = getCountries().map(code => ({
  code, dial: '+' + getCountryCallingCode(code),
  name: names.of(code) ?? code, english: english.of(code) ?? code,
})).sort((a, b) => a.code === 'CN' ? -1 : b.code === 'CN' ? 1 : a.name.localeCompare(b.name, 'zh-CN'));
const phoneTypes: Record<string, string> = {
  MOBILE: '移动号码', FIXED_LINE: '固定电话', FIXED_LINE_OR_MOBILE: '固定电话或移动号码',
  TOLL_FREE: '免费电话', PREMIUM_RATE: '高资费号码', SHARED_COST: '分摊费用号码',
  VOIP: '网络电话', PERSONAL_NUMBER: '个人号码', PAGER: '寻呼号码',
  UAN: '通用接入号码', VOICEMAIL: '语音信箱',
};
const errors: Record<string, string> = {
  NOT_A_NUMBER: '不是有效的电话号码', INVALID_COUNTRY: '国家或区号无效',
  TOO_SHORT: '号码位数过短', TOO_LONG: '号码位数过长', INVALID_LENGTH: '号码长度不符合编号规则',
};
export function inspectPhone(raw: string, country: CountryCode) {
  const input = raw.trim().replace(/^00(?=\d)/, '+');
  const number = parsePhoneNumberFromString(input, { defaultCountry: country, extract: false });
  if (!number) {
    const reason = validatePhoneNumberLength(input, country) ?? 'NOT_A_NUMBER';
    return { input: raw, valid: false, possible: false, mobile: '未知', reason: errors[reason] ?? reason };
  }
  const valid = number.isValid(), possible = number.isPossible(), kind = number.getType();
  const actualCountry = number.country;
  const mismatch = !!actualCountry && actualCountry !== country && input.startsWith('+');
  return {
    input: raw, valid, possible,
    mobile: !valid ? '未知' : kind === 'MOBILE' ? '是' : kind === 'FIXED_LINE_OR_MOBILE' ? '可能（编号规划无法区分）' : kind ? '否' : '未知',
    country: actualCountry ?? '非地理号码或未确定',
    countryName: actualCountry ? names.of(actualCountry) ?? actualCountry : null,
    callingCode: '+' + number.countryCallingCode,
    type: kind ? phoneTypes[kind] ?? kind : '未知',
    e164: number.number, international: number.formatInternational(),
    national: number.formatNational(), nationalNumber: number.nationalNumber,
    extension: number.ext ?? null,
    reason: valid ? null : errors[validatePhoneNumberLength(input, country) ?? ''] ?? '不符合当前国家或地区编号规划',
    note: mismatch ? '国际号码自带区号，已按实际国家/地区解析。' : null,
  };
}
export function processPhone(request: ToolRequest): ToolResult {
  const country = String(request.options.country ?? 'CN') as CountryCode;
  if (!phoneCountries.some(c => c.code === country)) throw new Error('请选择有效的国家或地区。');
  const lines = request.input.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!lines.length) throw new Error('请输入手机号或电话号码，每行一个号码。');
  const values = lines.map(line => inspectPhone(line, country));
  const valid = values.filter(v => v.valid).length;
  return {
    output: JSON.stringify(values.length === 1 ? values[0] : values, null, 2),
    kind: 'json',
    summary: '共 ' + values.length + ' 个号码 · ' + valid + ' 个符合编号规则 · ' + (values.length - valid) + ' 个无效',
    warnings: ['仅根据离线国际编号规划校验格式与号码类型，不代表号码已开通、真实存在或属于某个人。'],
  };
}
