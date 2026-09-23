export function assertNoCredentialLeak(value, secret) {
  const serialized = JSON.stringify(value);
  if (serialized.includes(secret))
    throw new Error('Credential value appeared in diagnostic output.');
}

export function assertNoCredentialInUrl(url, secret) {
  if (new URL(url).toString().includes(secret))
    throw new Error('Credential value appeared in a URL.');
}
