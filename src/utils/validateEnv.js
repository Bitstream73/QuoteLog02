export function validateEnv() {
  const required = ['GEMINI_API_KEY'];
  const optional = ['PINECONE_API_KEY', 'PINECONE_INDEX_HOST'];
  const missing = [];
  const warnings = [];

  for (const key of required) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  for (const key of optional) {
    if (!process.env[key]) {
      warnings.push(key);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
    warnings,
  };
}
