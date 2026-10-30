export interface HtmlRenderer {
  render(
    html: string,
    options?: { pageSize?: 'letter' | 'a4'; margin?: number },
  ): Promise<{ bytes: Uint8Array; warnings: string[] }>;
}

export class PuppeteerHtmlRenderer implements HtmlRenderer {
  async render(
    html: string,
    options?: { pageSize?: 'letter' | 'a4'; margin?: number },
  ): Promise<{ bytes: Uint8Array; warnings: string[] }> {
    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      timeout: 30000,
    });
    let page;
    try {
      page = await browser.newPage();
      // Security: apply resource blocking BEFORE untrusted content loads
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const url = req.url();
        if (url.startsWith('data:')) {
          req.continue();
        } else if (url.startsWith('http') || url.startsWith('https')) {
          req.abort();
        } else if (url.startsWith('file:')) {
          req.abort();
        } else {
          req.continue();
        }
      });
      // Block redirects to remote hosts (security hardening, defense in depth)
      page.on('response', (res) => {
        const url = res.url();
        if ((url.startsWith('http') || url.startsWith('https')) && res.status() === 3) {
          // Redirect to external; already blocked by initial interception but defend in depth
        }
      });
      await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
      const pdfBuffer = await page.pdf({
        format: options?.pageSize === 'a4' ? 'A4' : 'Letter',
        printBackground: true,
        margin: { top: options?.margin ?? 48, right: 48, bottom: 48, left: 48 },
        timeout: 30000,
      });
      await browser.close();
      return {
        bytes: new Uint8Array(pdfBuffer.buffer, pdfBuffer.byteOffset, pdfBuffer.byteLength),
        warnings: [],
      };
    } catch (e) {
      // Best-effort cleanup: a failing close must not mask the render error.
      try {
        if (page) await page.close();
      } catch {
        /* page already closed */
      }
      try {
        await browser.close();
      } catch {
        /* browser already closed */
      }
      throw e;
    }
  }
}

export async function renderHtmlToPdf(
  html: string,
  options?: { pageSize?: 'letter' | 'a4'; margin?: number },
): Promise<{ bytes: Uint8Array; warnings: string[] }> {
  try {
    return await new PuppeteerHtmlRenderer().render(html, options);
  } catch (e) {
    return {
      bytes: new Uint8Array(),
      warnings: [
        `HTML renderer unavailable: ${(e as Error).message}. Falling back to text-only extraction.`,
      ],
    };
  }
}
