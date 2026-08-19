"use client";

import Link from "next/link";
import { Capacitor } from "@capacitor/core";
import { useAuth } from "@/components/auth/AuthProvider";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { useSubscription } from "@/hooks/useSubscription";
import type { LocaleId } from "@/config/i18n.config";

const APP_VERSION = "0.1.0";

export default function SettingsPage() {
  const { subscription, isUnlimited, openUpgrade, licensedToolIds } = useSubscription();
  const { locale, setLocale, t, options } = useLocale();
  const { user, isAdmin, logout } = useAuth();
  const isNative = Capacitor.isNativePlatform();

  const activeBranch = user?.branches.find((b) => b.id === user.businessProfileId);

  return (
    <div>
      <div className="tool-header">
        <Link href="/" className="back-btn" aria-label="Back">←</Link>
        <div className="tool-header-text">
          <div className="tool-header-title">⚙️ Settings</div>
          <div className="tool-header-sub">App, account, subscription, and admin</div>
        </div>
      </div>

      <div className="settings-stack">
        <section className="card settings-card">
          <p className="card-label">App</p>
          <p className="card-value">JustX Business Tools v{APP_VERSION}</p>
          <p className="modal-msg">
            {isNative ? "Running as native Android app (Capacitor)." : "Running in browser."}
          </p>
          <Link href="/subscription" className="btn btn-secondary btn-sm">
            Subscription
          </Link>
        </section>

        <section className="card settings-card">
          <p className="card-label">Account</p>
          {user ? (
            <>
              <p className="card-value">{user.email}</p>
              <p className="modal-msg">
                {user.organizationName}
                {activeBranch ? ` · ${activeBranch.businessName}` : ""}
              </p>
              <div className="admin-form-row">
                {isAdmin ? (
                  <Link href="/admin" className="btn btn-secondary btn-sm">Open admin</Link>
                ) : null}
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => logout()}>
                  Sign out
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="modal-msg">Sign in for multi-branch access and admin tools.</p>
              <div className="admin-form-row">
                <Link href="/login" className="btn btn-primary btn-sm">Sign in</Link>
                <Link href="/register" className="btn btn-secondary btn-sm">Create account</Link>
              </div>
            </>
          )}
        </section>

        <section className="card settings-card">
          <p className="card-label">Plan</p>
          <p className="card-value">
            {isUnlimited
              ? "All tools licensed"
              : `${licensedToolIds.length} licensed tool${licensedToolIds.length === 1 ? "" : "s"}`}
            {subscription?.recordLimit != null && !isUnlimited ? ` · ${subscription.recordLimit} records / unlicensed tool` : ""}
          </p>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => openUpgrade()}>
            {licensedToolIds.length || isUnlimited ? "Manage tools" : "Subscribe"}
          </button>
        </section>

        <section className="card settings-card">
          <p className="card-label">Install</p>
          <p className="modal-msg">
            Use the install banner when prompted, or choose &quot;Add to Home Screen&quot; from your
            browser menu. Offline mode caches the app shell; API calls require network.
          </p>
        </section>

        <section className="card settings-card">
          <p className="card-label">{t("settings.locale")}</p>
          <p className="modal-msg">{t("settings.localeHint")}</p>
          <label className="field">
            <span className="label">{t("settings.locale")}</span>
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value as LocaleId)}
              aria-label={t("settings.locale")}
            >
              {options.map((opt) => (
                <option key={opt.id} value={opt.id} disabled={!opt.ready && opt.id !== "en-IN"}>
                  {opt.label}{opt.ready ? "" : " (preview)"}
                </option>
              ))}
            </select>
          </label>
        </section>

        {subscription?.provider ? (
          <p className="modal-msg settings-foot">Payment provider: {subscription.provider}</p>
        ) : null}
      </div>
    </div>
  );
}
