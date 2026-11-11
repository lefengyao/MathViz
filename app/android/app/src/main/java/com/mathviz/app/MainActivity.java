package com.mathviz.app;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * MathViz 手机端：一个 WebView 装 chat.deepseek.com，页面就绪后注入同一套业务 JS。
 *
 * 三处扩展 API 的替代：
 *   chrome.runtime.getURL  → Bridge.viewerUrl → 虚拟域名 https://mathviz.local/viewer.html
 *   chrome.storage.local   → Bridge.load / save → SharedPreferences
 *   content_scripts 声明   → onPageFinished 里 evaluateJavascript(assets/inject.js)
 *
 * viewer.html 走 shouldInterceptRequest 由本地 assets 提供，iframe 仍带
 * sandbox="allow-scripts"（无 allow-same-origin），模型代码拿不到页面 DOM 与登录态。
 */
public class MainActivity extends Activity {
    private static final String TAG = "MathVizMobile";
    private static final String HOST = "mathviz.local";
    private static final String VIEWER = "https://" + HOST + "/viewer.html";
    private static final String TARGET = "https://chat.deepseek.com";
    private static final String PREFS = "mv_settings";

    private WebView web;
    private String injectScript = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView.setWebContentsDebuggingEnabled(true);

        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);

        web.addJavascriptInterface(new Bridge(), "MathVizBridge");
        web.setWebViewClient(new HostClient());

        injectScript = readAsset("inject.js");
        if (injectScript.isEmpty()) Log.e(TAG, "inject.js 为空：请先跑 node build.mjs");
        web.loadUrl(TARGET);
    }

    private String readAsset(String name) {
        try (InputStream is = getAssets().open(name)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) > 0) out.write(buf, 0, n);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            Log.e(TAG, "读 assets 失败: " + name, e);
            return "";
        }
    }

    private class HostClient extends WebViewClient {
        /** 把沙箱页映射成本地文件；这个域名不联网，intercept 在 DNS/TLS 之前发生 */
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (HOST.equals(u.getHost()) && "/viewer.html".equals(u.getPath())) {
                try {
                    InputStream is = getAssets().open("viewer.html");
                    Map<String, String> h = new HashMap<>();
                    h.put("Access-Control-Allow-Origin", "*");
                    h.put("Cache-Control", "no-store");
                    return new WebResourceResponse("text/html", "utf-8", 200, "OK", h, is);
                } catch (IOException e) {
                    Log.e(TAG, "viewer.html 打不开", e);
                }
            }
            return super.shouldInterceptRequest(view, req);
        }

        /** 外链交给系统浏览器，别让这个小窗变成任意浏览器 */
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            String host = u.getHost();
            if (host != null && (host.equals("deepseek.com") || host.endsWith(".deepseek.com")
                    || HOST.equals(host))) return false;
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, u));
            } catch (Exception e) {
                Log.w(TAG, "打不开外链: " + u);
            }
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (url.startsWith(TARGET) && !injectScript.isEmpty()) {
                // content.js 自带 window.__mvLoaded 防重；SPA 内跳转不触发本回调，由 MO 接管
                view.evaluateJavascript(injectScript, null);
            }
        }
    }

    private class Bridge {
        @JavascriptInterface
        public String viewerUrl(String query) {
            return VIEWER + "?" + query;
        }

        @JavascriptInterface
        public String load() {
            SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
            try {
                return new JSONObject()
                        .put("mvMode", p.getString("mvMode", "auto"))
                        .put("mvAuto", p.getBoolean("mvAuto", false))
                        .toString();
            } catch (Exception e) {
                return "{\"mvMode\":\"auto\",\"mvAuto\":false}";
            }
        }

        @JavascriptInterface
        public void save(String json) {
            try {
                JSONObject o = new JSONObject(json);
                getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                        .putString("mvMode", o.optString("mvMode", "auto"))
                        .putBoolean("mvAuto", o.optBoolean("mvAuto", false))
                        .apply();
            } catch (Exception e) {
                Log.w(TAG, "设置保存失败: " + json);
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }
}
