export const formatDate = (date: Date): string => {
  return date.toLocaleDateString()
}

export const formatCurrency = (amount: number): string => {
  return `$${amount.toFixed(2)}`
}

