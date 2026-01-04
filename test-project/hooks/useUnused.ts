// THIS FILE IS UNUSED - Should be detected!
import { useState, useEffect } from 'react'

export const useUnused = () => {
  const [data, setData] = useState(null)
  
  useEffect(() => {
    // Never used
  }, [])
  
  return data
}

