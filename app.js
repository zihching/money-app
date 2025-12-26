const { createApp, ref } = Vue;

const app = createApp({
  setup() {
    // 1. 資料區
    const appTitle = ref('家庭記帳系統'); 

    // 2. 功能區
    // (之後把你的收錢邏輯搬來這裡)

    return {
      appTitle
    };
  }
});

app.mount('#app');
