package app.inkstrip.studio;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /** Closes an open Inkstrip dialog/menu (Radix listens for Escape) and reports whether one was open. */
    private static final String CLOSE_OVERLAY_JS =
        "(function(){var d=document.querySelector('[role=dialog][data-state=open],[role=alertdialog][data-state=open],[role=menu][data-state=open],[data-radix-popper-content-wrapper]');" +
        "if(!d)return false;var t=document.activeElement||document.body;" +
        "t.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,bubbles:true,cancelable:true}));return true;})()";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(InkstripNativePlugin.class);
        super.onCreate(savedInstanceState);

        // Android back: close an open dialog first, then go back in the web history,
        // and only leave the app from the first screen.
        getOnBackPressedDispatcher().addCallback(
            this,
            new OnBackPressedCallback(true) {
                @Override
                public void handleOnBackPressed() {
                    WebView webView = getBridge() == null ? null : getBridge().getWebView();
                    if (webView == null) {
                        exitApp();
                        return;
                    }
                    webView.evaluateJavascript(CLOSE_OVERLAY_JS, closed -> {
                        if ("true".equals(closed)) return;
                        if (webView.canGoBack()) webView.goBack();
                        else exitApp();
                    });
                }

                private void exitApp() {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                    setEnabled(true);
                }
            }
        );
    }
}
