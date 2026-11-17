// crypto.randomUUID polyfill for non-secure contexts.
//
// Why this exists: PixOffice's bundles call `globalThis.crypto.randomUUID()`
// unconditionally in constructors (primitives-aSK3-qga.js builds
// `runtime-${randomUUID()}`, office-DlFndzZI.js builds `prop-${randomUUID()}`).
// `Crypto.randomUUID` is a [SecureContext] API: it is undefined when the page
// is served over plain http, over https with a self-signed certificate the
// browser does not trust, or from an origin the browser does not treat as
// potentially trustworthy. The result is a TypeError thrown inside a React
// render, which blanks the whole office scene.
//
// `crypto.getRandomValues` has no such restriction, so it carries the fallback.
// Loaded synchronously from <head> before any module script: a module script
// is deferred by default, so a classic script placed earlier still runs first.
//
// SPDX-License-Identifier: Apache-2.0

(function installRandomUUIDPolyfill () {
  'use strict'

  /** Build an RFC 4122 v4 UUID from 16 random bytes. */
  function buildV4 (bytes) {
    // Version nibble (bits 4-7 of byte 6) = 4, variant (bits 6-7 of byte 8) = 10.
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    var hex = ''
    for (var i = 0; i < 16; i += 1) {
      var b = bytes[i]
      if (i === 4 || i === 6 || i === 8 || i === 10) hex += '-'
      hex += (b < 16 ? '0' : '') + b.toString(16)
    }
    return hex
  }

  var cryptoObj = globalThis.crypto
  if (!cryptoObj) {
    cryptoObj = {}
    try {
      Object.defineProperty(globalThis, 'crypto', { value: cryptoObj, configurable: true, writable: true })
    } catch (e) {
      // A host that forbids redefining crypto gives us nothing to patch; the
      // scene will fail exactly as it does today, but not because of us.
      return
    }
  }
  if (typeof cryptoObj.randomUUID === 'function') return

  var impl
  if (typeof cryptoObj.getRandomValues === 'function') {
    impl = function randomUUID () {
      var bytes = new Uint8Array(16)
      cryptoObj.getRandomValues(bytes)
      return buildV4(bytes)
    }
  } else {
    // Last resort: no CSPRNG at all. IDs stay unique enough for scene objects;
    // they are not security-relevant here (local storage keys and command ids).
    impl = function randomUUID () {
      var bytes = new Uint8Array(16)
      for (var i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256)
      return buildV4(bytes)
    }
  }

  try {
    Object.defineProperty(cryptoObj, 'randomUUID', { value: impl, configurable: true, writable: true })
  } catch (e) {
    // Own property assignment is the fallback for hosts that refuse
    // defineProperty on the Crypto instance.
    try { cryptoObj.randomUUID = impl } catch (e2) { /* give up quietly */ }
  }
})()
