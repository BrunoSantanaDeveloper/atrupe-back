/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');

const stackPath = process.argv[2];
const envPath = process.argv[3];

if (!stackPath || !envPath) {
  console.error('Usage: node prepare-stack.js <stack-file> <env-file>');
  process.exit(1);
}

try {
  // 1. Read and parse the env file
  const envContent = fs.readFileSync(envPath, 'utf8');
  const envVars = {};
  const lines = envContent.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim();
      // Remove wrapping quotes if present
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      envVars[key] = value;
    }
  }

  // 2. Read the stack file
  let stackContent = fs.readFileSync(stackPath, 'utf8');

  // 3. Generate the environment block in YAML format
  let envBlock = '    environment:\n';
  for (const [key, value] of Object.entries(envVars)) {
    // Escape double quotes and backslashes for YAML double-quoted string
    const escapedValue = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    envBlock += `      ${key}: "${escapedValue}"\n`;
  }

  // 4. Replace env_file: <path> with the environment block
  // Matches both 'env_file: path' and list format 'env_file:\n  - path'
  const envFileRegex = /^[ \t]*env_file:([ \t]*.*(\r?\n[ \t]*-.*)*)$/m;
  if (!envFileRegex.test(stackContent)) {
    console.error('Error: env_file directive not found in stack file');
    process.exit(1);
  }

  stackContent = stackContent.replace(envFileRegex, envBlock.trimEnd());

  // 5. Output the result to stdout
  console.log(stackContent);
} catch (error) {
  console.error('Error preparing stack file:', error.message);
  process.exit(1);
}
