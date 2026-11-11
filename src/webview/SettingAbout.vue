<template>
  <dt id="about">关于 LX Music · WebView</dt>
  <dd style="line-height:1.9">
    <p>无 Node 的实验版，保留原 LX 界面。此版本独立于正式版分支维护，未发布市场，未验证 Java 版宿主。</p>
    <p>By: <strong>jiang66-so</strong> · From: <strong>落雪无痕（lyswhut）</strong></p>
    <p>运行依赖现代 WebView 的 IndexedDB、Worker、Web Crypto 和音频能力。网络受宿主跨域策略限制，不附带音源。</p>
    <p>页面内歌词保留；独立桌面歌词、同步和开放 API 等系统服务需要进一步宿主接口适配。</p>
    <base-btn min @click="showLicense">查看许可协议</base-btn>
  </dd>
</template>
<script setup>
import { isShowPact } from '@renderer/store'
const showLicense = () => { isShowPact.value = true }
</script>
