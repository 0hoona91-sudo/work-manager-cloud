// Release-only contracts. All records and credentials here are synthetic.
const assert = require('node:assert/strict');
const { withPage } = require('./browser.test.cjs');

module.exports = ({ test, EnvironmentUnavailable }) => {
  test('RELEASE-LIST-01', 'Chromium shows 1k/10k tasks through bounded pages without changing search or saving', () =>
    withPage({ width: 1440, height: 900 }, EnvironmentUnavailable, async page => {
      page.setDefaultTimeout(120000);
      const result = await page.evaluate(() => {
        let writes = 0;
        const oldSave = saveState;
        saveState = () => { writes++; return Promise.resolve(); };
        const measure = count => {
          state.tasks = Array.from({length:count}, (_,i) => ({
            id:`release-${String(i).padStart(5,'0')}`,name:`합성 업무 ${i}`,category:'기타',
            status:'planned',start:'2026-10-23',end:'2026-10-24',checklist:[],attachments:[],
          }));
          state.settings.taskListViewV35='active';
          document.querySelector('#taskSearch').value='';
          document.querySelector('#taskStatusFilter').value='all';
          const start=performance.now();
          showPage('taskListPage');
          const elapsed=Math.round(performance.now()-start);
          const rows=document.querySelectorAll('#taskTableBody tr').length;
          const pages=document.querySelector('#taskListPageSelectRelease')?.options.length||1;
          return {elapsed,rows,pages};
        };
        try{
          const thousand=measure(1000),tenThousand=measure(10000);
          const picker=document.querySelector('#taskListPageSelectRelease');
          picker.value='19';picker.dispatchEvent(new Event('change',{bubbles:true}));
          const lastRows=document.querySelectorAll('#taskTableBody tr').length;
          document.querySelector('#taskSearch').value='합성 업무 9999';
          renderTaskTable();
          const matches=[...document.querySelectorAll('#taskTableBody .task-link')].map(x=>x.textContent);
          return {thousand,tenThousand,lastRows,matches,searchPages:picker.options.length,writes,sourceCount:state.tasks.length};
        }finally{saveState=oldSave;}
      });
      assert.equal(result.thousand.rows,1000);
      assert.equal(result.thousand.pages,1);
      assert.equal(result.tenThousand.rows,500);
      assert.equal(result.tenThousand.pages,20);
      assert.equal(result.lastRows,500);
      assert.deepEqual(result.matches,['합성 업무 9999']);
      assert.equal(result.searchPages,1);
      assert.equal(result.sourceCount,10000);
      assert.equal(result.writes,0);
      console.log(`RELEASE-LIST synthetic measured ms: 1k=${result.thousand.elapsed}, 10k=${result.tenThousand.elapsed}`);
    }));
};
