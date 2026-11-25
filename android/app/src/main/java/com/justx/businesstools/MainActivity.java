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
   * Native phone layout: honor the page viewport meta at 1×. Overview mode
   * shrink-to-fits a desktop width into the screen (tiny UI + dead space).
   */
  private void configureWebView() {
    if (getBridge() == null) return;
    WebView webView = getBridge().getWebView();
    if (webView == null) return;
    WebSettings settings = webView.getSettings();
    settings.setLoadWithOverviewMode(false);
    settings.setUseWideViewPort(true);
    settings.setSupportZoom(false);
    settings.setBuiltInZoomControls(false);
    settings.setDisplayZoomControls(false);
    settings.setTextZoom(100);
    webView.setInitialScale(100);
  }
}
