import { useEffect, useState } from 'react'

interface Config {
  napUrl: string
  sandboxDomain: string
}

const defaultConfig: Config = { napUrl: '', sandboxDomain: '' }

let cached: Config | null = null

export function useConfig(): Config {
  const [config, setConfig] = useState<Config>(cached || defaultConfig)

  useEffect(() => {
    if (cached) return
    fetch('/api/config')
      .then((r) => r.json())
      .then((data: Config) => {
        cached = data
        setConfig(data)
      })
      .catch(() => {})
  }, [])

  return config
}
