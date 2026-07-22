import { expect, test } from '@playwright/test';

import { E2E_BASE_URL } from './fixtures/base-url';

const viewports = [
  { name: 'phone-320', width: 320, height: 720 },
  { name: 'phone-375', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'wide', width: 1920, height: 1080 },
] as const;

for (const viewport of viewports) {
  for (const theme of ['light', 'dark'] as const) {
    test(`${theme} button materials render at ${viewport.name}`, async ({ context, page }) => {
      await page.setViewportSize(viewport);
      await context.addCookies([{
        name: 'deckforge_language',
        value: 'en',
        url: E2E_BASE_URL,
      }]);
      await page.addInitScript(({ selectedTheme }) => {
        window.localStorage.setItem('theme', selectedTheme);
        window.localStorage.setItem('deckforge_language', 'en');
      }, { selectedTheme: theme });

      const consoleErrors: string[] = [];
      const failedResponses: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      page.on('response', (response) => {
        if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
      });

      await page.goto('/login');
      await expect(page.locator('html')).toHaveClass(new RegExp(theme));

      const primary = page.locator('[data-auth-panel="login"] .button-material-primary').first();
      const themeToggle = page.getByRole('button', { name: /toggle theme/i });
      const backButton = page.getByRole('link', { name: /back/i });

      await expect(primary).toBeVisible();
      await expect(themeToggle).toBeVisible();
      await expect(backButton).toBeVisible();
      await expect(page.locator('[data-binance-mark]').first()).toBeVisible();

      const materialStyle = await primary.evaluate((element) => {
        const style = window.getComputedStyle(element);
        return {
          backgroundImage: style.backgroundImage,
          borderRadius: style.borderRadius,
          borderStyle: style.borderStyle,
          boxShadow: style.boxShadow,
          color: style.color,
          transitionDuration: style.transitionDuration,
          transitionProperty: style.transitionProperty,
          top: element.getBoundingClientRect().top,
          translateY: new DOMMatrixReadOnly(style.transform).m42,
        };
      });

      expect(materialStyle.backgroundImage).toContain('linear-gradient');
      expect(materialStyle.borderRadius).toBe('8px');
      expect(materialStyle.borderStyle).toBe('solid');
      expect(materialStyle.boxShadow).not.toBe('none');
      expect(materialStyle.transitionDuration).toBe('0s');
      expect(materialStyle.transitionProperty).toBe('none');
      expect(materialStyle.translateY).toBe(0);
      if (theme === 'dark') {
        expect(materialStyle.backgroundImage).toContain('rgb(240, 185, 11)');
        expect(materialStyle.color).toBe('rgb(20, 20, 19)');
      } else {
        expect(materialStyle.backgroundImage).toContain('rgb(41, 37, 36)');
        expect(materialStyle.color).toBe('rgb(250, 250, 249)');
      }

      await primary.hover();
      await expect.poll(() => primary.evaluate((element) => ({
        top: element.getBoundingClientRect().top,
        translateY: new DOMMatrixReadOnly(window.getComputedStyle(element).transform).m42,
      }))).toEqual({ top: materialStyle.top, translateY: 0 });

      await page.mouse.down();
      await expect.poll(() => primary.evaluate((element) => ({
        top: element.getBoundingClientRect().top,
        translateY: new DOMMatrixReadOnly(window.getComputedStyle(element).transform).m42,
      }))).toEqual({ top: materialStyle.top, translateY: 0 });
      await page.mouse.move(0, 0);
      await page.mouse.up();

      await primary.evaluate((element) => element.setAttribute('disabled', ''));
      await expect.poll(() => primary.evaluate((element) => window.getComputedStyle(element).boxShadow))
        .toBe('none');
      await primary.evaluate((element) => element.removeAttribute('disabled'));

      expect(await backButton.evaluate((element) => window.getComputedStyle(element).boxShadow)).toBe('none');
      expect(await themeToggle.evaluate((element) => window.getComputedStyle(element).backgroundImage))
        .toContain('linear-gradient');

      await page.screenshot({
        path: `/tmp/xarticle-buttons-${viewport.name}-${theme}-login.png`,
        fullPage: true,
      });

      const originalTheme = theme;
      await themeToggle.click();
      await expect(page.locator('html')).not.toHaveClass(new RegExp(originalTheme));

      await page.evaluate((selectedTheme) => {
        window.localStorage.setItem('theme', selectedTheme);
      }, originalTheme);
      await page.goto('/');
      await expect(page.locator('html')).toHaveClass(new RegExp(theme));
      await expect(page.locator('body')).toBeVisible();
      const composer = page.locator('[data-article-studio-composer]');
      const promptInput = page.locator('.studio-prompt-input');
      await expect(composer).toBeVisible();
      await expect(promptInput).toBeVisible();
      expect(await composer.evaluate((element) => element.getBoundingClientRect().width)).toBeLessThanOrEqual(769);
      expect(await promptInput.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThanOrEqual(97);
      const hasHorizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(hasHorizontalOverflow).toBe(false);
      await page.screenshot({
        path: `/tmp/xarticle-buttons-${viewport.name}-${theme}-home.png`,
        fullPage: true,
      });

      if (viewport.width >= 768) {
        const collapseButton = page.getByRole('button', { name: /close article navigation/i });
        await collapseButton.click();

        const collapsedBrand = page.locator('[data-studio-sidebar-collapsed-control]');
        await expect(collapsedBrand.locator('[data-binance-mark]')).toBeVisible();
        await collapsedBrand.hover();
        await expect(collapsedBrand).toHaveAttribute('data-visual', 'open');
        await expect(collapsedBrand.locator('[data-binance-mark]')).toHaveCount(0);
        await page.mouse.move(viewport.width / 2, viewport.height / 2);
        await expect(collapsedBrand).toHaveAttribute('data-visual', 'logo');
        await expect(collapsedBrand.locator('[data-binance-mark]')).toBeVisible();
      }

      expect(consoleErrors).toEqual([]);
      expect(failedResponses).toEqual([]);
    });
  }
}
