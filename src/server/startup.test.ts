import { describe, expect, it } from 'vitest'
import { vendorOf } from './startup.js'

describe('vendorOf', () => {
  it('reads the vendor from reverse-DNS labels, skipping team ID prefixes', () => {
    expect(vendorOf('com.adobe.AdobeCreativeCloud')).toBe('adobe')
    expect(vendorOf('UBF8T346G9.com.microsoft.entrabroker.EntraIdentityBrokerXPC.Client')).toBe('microsoft')
    expect(vendorOf('syncthing')).toBe('syncthing')
  })
})
