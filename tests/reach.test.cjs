const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { root } = require('./helpers.cjs');
const { withPage } = require('./browser.test.cjs');

module.exports = ({ test, EnvironmentUnavailable }) => {
  test('STYLE-VISUAL-01', 'Mobile home hero keeps the previously rendered 22px heading', async () => {
    for (const width of [320, 390]) {
      await withPage({ width, height: 900 }, EnvironmentUnavailable, async page => {
        const fontSize = await page.locator('.home-hero-v21 h2').evaluate(element => getComputedStyle(element).fontSize);
        assert.equal(fontSize, '22px');
      });
    }
  });
  test('REACH-01', 'Removed holiday stripe has no production reference; calendar still renders holidays', () =>
    withPage({ width: 390, height: 844 }, EnvironmentUnavailable, async page => {
      const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
      assert.doesNotMatch(source, /holiday-stripe/);
      for (const file of fs.readdirSync(path.join(root, 'js'))) {
        if (file.endsWith('.js')) assert.doesNotMatch(fs.readFileSync(path.join(root, 'js', file), 'utf8'), /holiday-stripe/);
      }
      const result = await page.evaluate(() => {
        showPage('homePage');
        state.settings.homeView = 'calendar';
        renderHome();
        return { calendar: !!document.querySelector('.calendar'), holiday: document.body.textContent.includes('한글날') };
      });
      assert.equal(result.calendar, true);
      assert.equal(result.holiday, true);
    }));
};
