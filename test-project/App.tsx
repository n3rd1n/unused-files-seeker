import React from 'react'
import { Button } from './components/Button'
import { useCounter } from './hooks/useCounter'
import { formatDate } from './utils/format'

export const App = () => {
  const { count, increment } = useCounter()
  
  return (
    <div>
      <h1>Hello World</h1>
      <p>Count: {count}</p>
      <p>Date: {formatDate(new Date())}</p>
      <Button onClick={increment}>Click me</Button>
    </div>
  )
}

