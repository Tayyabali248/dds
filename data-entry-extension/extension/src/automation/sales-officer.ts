/**
 * Reads the PTCL username out of the POMS page's own (disabled) "Sales
 * Officer" box - the page fills it with whoever is logged in, so the user
 * never has to type their username into the extension.
 *
 * IMPORTANT: this function is injected into the page by
 * scripting.executeScript, which serializes only this function's own source.
 * It must therefore be completely self-contained - no imports, no closure
 * variables, no helpers from elsewhere in the bundle. The selector from the
 * field mapping is passed in as an argument for the same reason.
 *
 * Injection (rather than messaging the content script) is deliberate: it
 * works on a tab whose content script never attached - e.g. the tab was
 * already open when the extension was reloaded, or the page URL doesn't
 * match the content_scripts pattern - and it can be run against every frame.
 */
export function readSalesOfficerInPage(primarySelector: string): string | null {
  const selectors = [
    primarySelector,
    '#txtSalesofficer',
    'input[name="txtSalesofficer"]',
    // ASP.NET rewrites control ids/names when the form sits inside a master
    // page or user control (e.g. ctl00$ContentPlaceHolder1$txtSalesofficer).
    '[id$="txtSalesofficer"]',
    '[name$="txtSalesofficer"]',
  ];

  for (const selector of selectors) {
    let element: HTMLInputElement | null = null;
    try {
      element = document.querySelector(selector) as HTMLInputElement | null;
    } catch {
      continue; // Bad selector from a stale mapping - just try the next one.
    }
    const value = (element?.value ?? '').trim();
    if (value) return value;
  }

  // Last resort: any input whose id or name mentions the field in any
  // casing. The real page uses "txtSalesofficer" (lowercase 'o'), so an
  // exact-case selector is a single typo away from silently failing.
  const inputs = document.querySelectorAll('input');
  for (let i = 0; i < inputs.length; i += 1) {
    const input = inputs[i] as HTMLInputElement;
    const key = `${input.id} ${input.name}`.toLowerCase();
    if (key.indexOf('salesofficer') !== -1 || key.indexOf('sales_officer') !== -1) {
      const value = (input.value ?? '').trim();
      if (value) return value;
    }
  }

  return null;
}
