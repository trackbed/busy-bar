import { describe, expect, it } from 'vitest';

import { catalogueApp } from './__tests__/fixtures.ts';
import { cataloguePage } from './page.ts';

function page(apps = [catalogueApp()]): string {
  return cataloguePage({
    apps,
    style: 'body { color: red; }\n',
    firmwareCommit: 'a11df43b98927a3cbeb15584f8c4a6f470a12d5b',
    rootHref: '../..',
  });
}

describe('cataloguePage', () => {
  it('lists every app in the index and gives each its own section', () => {
    const html = page([
      catalogueApp(),
      catalogueApp({
        project: {
          name: 'countdown',
          root: 'apps/countdown',
          language: 'Python',
          preview: { command: 'uv run', cwd: 'apps/countdown' },
        },
      }),
    ]);

    expect(html).toContain('2 small programs');
    expect(html).toContain('<a href="#clock"><code>clock</code>');
    expect(html).toContain('<a href="#countdown"><code>countdown</code>');
    expect(html).toContain('<article class="app" id="countdown"');
    expect(html).toContain('data-language="Python"');
  });

  it('inlines the style and both displays, described by their text', () => {
    const html = page();

    expect(html).toContain('<style>\nbody { color: red; }\n</style>');
    expect(html).toContain('src="data:image/png;base64,AQID"');
    expect(html).toContain('alt="clock, Morning, front display: 09:41"');
    expect(html).toContain('src="data:image/png;base64,BAUG"');
    expect(html).toContain('alt="clock, Morning, back display: blank"');
  });

  it('shows how the app works, how to run it, and where to read more', () => {
    const html = page();

    expect(html).toContain(
      '<div><dt>Draws</dt><dd>HH:MM over a seconds bar.</dd></div>',
    );
    expect(html).toContain('NX_DAEMON=false yarn nx run clock:start');
    expect(html).toContain('href="../../apps/clock/README.md"');
    expect(html).toContain('firmware <code>a11df43</code>');
  });

  it('escapes what the apps print', () => {
    const html = page([catalogueApp({ summary: 'Fish & <chips> "now"' })]);

    expect(html).toContain('Fish &amp; &lt;chips&gt; &quot;now&quot;');
    expect(html).not.toContain('<chips>');
  });
});
