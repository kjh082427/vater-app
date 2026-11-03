// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import openapiTS, { astToString } from 'openapi-typescript';
import { format, resolveConfig } from 'prettier';
import { describe, expect, it } from 'vitest';

// API 계약(스펙 2-2): 사이드카 OpenAPI 스냅샷이 바뀌었는데 schema.d.ts를 다시 만들지 않으면 실패한다.
const here = import.meta.dirname;
const specPath = join(here, '../../../../sidecar/tests/snapshots/openapi.json');
const schemaPath = join(here, 'schema.d.ts');

describe('schema.d.ts', () => {
  it('사이드카 OpenAPI 스냅샷에서 만든 결과와 같다 (다르면 npm run gen:api)', async () => {
    const spec = JSON.parse(readFileSync(specPath, 'utf8')) as Parameters<typeof openapiTS>[0];
    const generated = astToString(await openapiTS(spec));
    const config = (await resolveConfig(schemaPath)) ?? {};
    const expected = await format(generated, { ...config, filepath: schemaPath });
    // CLI가 붙이는 머리 주석("auto-generated")만 빼고 비교한다
    const committed = readFileSync(schemaPath, 'utf8').replace(/^\/\*\*[\s\S]*?\*\/\n\n/, '');
    expect(committed).toBe(expected);
  }, 30_000);
});
