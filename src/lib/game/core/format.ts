export function formatMoney(value: number): string {
  return `${value.toLocaleString("pl-PL").replace(/\s/g, " ")} zł`;
}

export function formatPhone(phone: string): string {
  return `${phone.slice(0, 3)}-${phone.slice(3)}`;
}
