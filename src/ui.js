export function initApp() {
  const scheduleList = document.getElementById('scheduleList');
  if (scheduleList) {
    scheduleList.textContent = '应用骨架已加载，后续任务会接入计划逻辑。';
  }
}
