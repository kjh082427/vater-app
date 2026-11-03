/** 받침이 있으면 "을", 없으면 "를". 한글이 아닌 글자로 끝나면 "을(를)". */
export function withObjectParticle(word: string): string {
  if (!word) return word;
  const code = word.charCodeAt(word.length - 1);
  if (code < 0xac00 || code > 0xd7a3) return `${word}을(를)`;
  return `${word}${(code - 0xac00) % 28 === 0 ? '를' : '을'}`;
}
