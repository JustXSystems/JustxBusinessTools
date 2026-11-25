package com.justx.businesstools;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    configureWebView();
  }

  @Override
  public void onStart() {
    super.onStart();
    configureWebView();
  }

  /**
   * Prevent Chrome WebView "overview"/shrink-to-fit zoom that makes the Pinway
   * UI look like a tiny desktop page on phones.
   */
  private void configureWebView() {
    if (getBridge() == null) return;
    WebView webView = getBridge().getWebView();
    if (webView == null) return;
    WebSettings settings = webView.getSettings();
    settings.setLoadWithOverviewMode(false);
    settings.setUseWideViewPort(true);
    settings.setTextZoom(100);
  }
}
