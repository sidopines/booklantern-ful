# 📧 Supabase Email Template Fix - Implementation Guide

**Date:** November 10, 2025  
**Status:** Ready for manual implementation  
**Priority:** HIGH - Fixes magic link authentication

---

## 🎯 Objective

Update Supabase email templates to use the conditional fallback logic that ensures magic links contain proper verification URLs with tokens.

---

## ✅ The Fix: Conditional Template Logic

Replace any `<a href="...">` tags in email templates with:

```html
{{ if .ActionURL }}{{ .ActionURL }}{{ else }}{{ .ConfirmationURL }}{{ end }}
```

**Why this works:**
- `{{ .ActionURL }}` includes the full Supabase verification URL: `https://PROJECT.supabase.co/auth/v1/verify?token=...&redirect_to=https://booklantern.org/auth/callback`
- Fallback to `{{ .ConfirmationURL }}` ensures compatibility
- Our client code (`public/js/auth-send.js`) already forces `emailRedirectTo: '/auth/callback'`

---

## 📋 STEP 1: Access Supabase Dashboard

1. Open browser and navigate to: **https://supabase.com/dashboard**
2. Sign in to your account
3. Select the **BookLantern** project
4. Click **Authentication** in the left sidebar
5. Click **Email Templates**

---

## 📋 STEP 2: Update Magic Link Template

### Location
Authentication → Email Templates → **Magic Link** (Passwordless Sign-In)

### Actions
1. Click the **Edit** button on the Magic Link template
2. Find the button/link section (usually has `<a href="...">`):

**Find this (current broken version):**
```html
<a href="{{ .SiteURL }}/login?confirmed=1">Sign in to BookLantern</a>
```
**OR**
```html
<a href="{{ .ConfirmationURL }}">Sign in to BookLantern</a>
```

**Replace with:**
```html
<a href="{{ if .ActionURL }}{{ .ActionURL }}{{ else }}{{ .ConfirmationURL }}{{ end }}">Sign in to BookLantern</a>
```

3. Click **Save** (bottom right)
4. **IMPORTANT:** Click **Send test email** and enter your email to verify

---

## 📋 STEP 3: Update Confirm Signup Template

### Location
Authentication → Email Templates → **Confirm Signup**

### Actions
1. Click the **Edit** button on the Confirm Signup template
2. Find the confirmation link:

**Find this:**
```html
<a href="{{ .SiteURL }}/login?confirmed=1">Confirm your email</a>
```

**Replace with:**
```html
<a href="{{ if .ActionURL }}{{ .ActionURL }}{{ else }}{{ .ConfirmationURL }}{{ end }}">Confirm your email</a>
```

3. Click **Save**

---

## 📋 STEP 4: Update Email Change Template (if exists)

### Location
Authentication → Email Templates → **Email Change** (if available)

### Actions
1. If this template exists, click **Edit**
2. Update the confirmation link similarly
3. Click **Save**

---

## 📋 STEP 5: Verify URL Configuration

### Location
Authentication → **URL Configuration**

### Required Settings
- **Site URL:** `https://booklantern.org`
- **Redirect URLs (allowlist):**
  - `https://booklantern.org/auth/callback`
  - `https://booklantern.org/auth`
  - `https://booklantern.org/*`
  - `http://localhost:10000/auth/callback` (for local dev)

Click **Save** if any changes needed.

---

## 🧪 STEP 6: Test Email Verification

After updating templates, send a test email from Supabase:

1. In Email Templates → Magic Link → Click **Send test email**
2. Enter your email address
3. Check your inbox
4. **Right-click the button** → "Inspect Element" or view email source
5. **Verify the href attribute:**

### ✅ Expected (CORRECT):
```html
<a href="https://YOURPROJECT.supabase.co/auth/v1/verify?token=abc123...&redirect_to=https://booklantern.org/auth/callback">
```

### ❌ NOT Expected (WRONG):
```html
<a href="https://booklantern.org/login?confirmed=1">
<a href="">  <!-- empty href -->
```

**PASTE RAW HTML HERE:**
```html
<!-- Copy and paste the <a> tag from the test email -->


```

**Test email verification:**
- [ ] Test email received
- [ ] Button has valid href (not empty)
- [ ] Link goes to supabase.co/auth/v1/verify
- [ ] Link includes `redirect_to=https://booklantern.org/auth/callback`

---

## 🔧 STEP 7: Purge Cloudflare Cache

**CRITICAL:** The cache must be purged or the old 302 redirect will still serve.

### Method 1: Custom Purge (Recommended)

1. Navigate to: **https://dash.cloudflare.com**
2. Select **booklantern.org** domain
3. Click **Caching** → **Configuration**
4. Click **Custom Purge** → **Purge by URL**
5. Enter these URLs (one per line):
   ```
   https://booklantern.org/auth
   https://booklantern.org/auth/callback
   https://booklantern.org/login
   https://booklantern.org/register
   ```
6. Click **Purge**

### Method 2: Development Mode (Alternative)

1. Go to **Caching** → **Configuration**
2. Toggle **Development Mode** to ON
3. Wait 3 hours for it to expire (or toggle off after testing)

### Verification Command
```bash
curl -sI https://booklantern.org/auth/callback | head -1
```

**Expected:** `HTTP/2 200`  
**NOT Expected:** `HTTP/2 302` (stale cache)

---

## 🧪 STEP 8: Full End-to-End Magic Link Test

**Prerequisites:**
- [ ] Supabase templates updated and saved
- [ ] Test email sent and verified
- [ ] Cloudflare cache purged
- [ ] Waited 60 seconds

### Test Procedure

#### 1. Request Magic Link
```
1. Open https://booklantern.org/auth in INCOGNITO window
2. Enter your email address
3. Click "Send magic link"
4. Verify: "Check your email" message appears
```

#### 2. Check Email
```
1. Open email inbox
2. Find NEW email (sent AFTER template update)
3. Right-click button → Inspect element
4. Verify href format contains: supabase.co/auth/v1/verify?token=...&redirect_to=.../auth/callback
```

#### 3. Open DevTools Network Tab
```
1. Open browser DevTools (F12)
2. Go to Network tab
3. Keep it open for next step
```

#### 4. Click Magic Link
```
1. Click the button in the email
2. Watch the Network tab
3. Observe the redirect sequence
```

#### 5. Verify Successful Login
```
Expected flow:
1. Supabase verification page (brief flash)
2. Redirect to: booklantern.org/auth/callback#access_token=...&refresh_token=...
3. "Completing sign-in..." message (1-2 seconds)
4. Redirect to: booklantern.org/account
5. User authenticated and logged in
```

---

## 📊 TEST RESULTS

### Template Updates Completed

**Magic Link template:**
- [ ] Updated with conditional: `{{ if .ActionURL }}{{ .ActionURL }}{{ else }}{{ .ConfirmationURL }}{{ end }}`
- [ ] Saved in production
- [ ] Test email sent
- [ ] Test email verified

**Confirm Signup template:**
- [ ] Updated with conditional logic
- [ ] Saved in production

**Email Change template:**
- [ ] Updated (or N/A if doesn't exist)
- [ ] Saved in production

**Timestamp:** ___/___/___ at __:__ AM/PM

---

### Test Email Analysis

**Test email sent:** ___/___/___ at __:__ AM/PM

**Raw HTML from test email:**
```html
<!-- Paste the <a href="...">...</a> tag here -->


```

**Link format verification:**
- [ ] ✅ Link goes to `supabase.co/auth/v1/verify?token=...`
- [ ] ✅ Includes `redirect_to=https://booklantern.org/auth/callback`
- [ ] ❌ Link goes directly to `/login?confirmed=1` (WRONG - template not updated)
- [ ] ❌ Link href is empty (WRONG - template syntax error)

---

### Cloudflare Cache Purge

**Cache purged:** ___/___/___ at __:__ AM/PM

**Method used:**
- [ ] Custom Purge (4 URLs)
- [ ] Development Mode (3 hours)

**Verification after purge:**
```bash
curl -sI https://booklantern.org/auth/callback | head -1
```
**Result:** _______________

**Expected:** `HTTP/2 200`

---

### End-to-End Magic Link Flow

**Test started:** ___/___/___ at __:__ AM/PM

**Magic Link Request:**
- [ ] Opened https://booklantern.org/auth in incognito
- [ ] Entered email address
- [ ] Clicked "Send magic link"
- [ ] Saw "Check your email" message

**Email Received:**
- [ ] Received email within 30 seconds
- [ ] Email button clickable (not empty href)
- [ ] Right-clicked button to verify href
- [ ] Confirmed Supabase verification URL format

**Browser Network Tab Sequence:**
```
1. _______________________________________________
2. _______________________________________________
3. _______________________________________________
```

**Expected sequence:**
```
1. GET https://PROJECT.supabase.co/auth/v1/verify?token=... (302)
2. GET https://booklantern.org/auth/callback#access_token=... (200)
3. GET https://booklantern.org/account (200)
```

**Link Click Results:**
- [ ] Clicked magic link button
- [ ] Saw Supabase verification page (brief)
- [ ] Redirected to `/auth/callback#access_token=...`
- [ ] Saw "Completing sign-in..." message
- [ ] Redirected to `/account`
- [ ] Successfully authenticated
- [ ] Can access account features

**Final Authentication Status:**
- [ ] ✅ Logged in successfully
- [ ] ✅ No infinite loops
- [ ] ✅ No repeated `/login?confirmed=1` requests
- [ ] ❌ Still seeing loops (template or cache issue)

---

### Render.com Logs Analysis

**Access:** https://dashboard.render.com → BookLantern service → Logs

**Log entries during test:**
```
[timestamp] _______________________________________________
[timestamp] _______________________________________________
[timestamp] _______________________________________________
```

**Expected (clean flow):**
```
[timestamp] GET /auth/callback - 200
[timestamp] GET /account - 200
```

**NOT expected (broken):**
```
[timestamp] GET /login?confirmed=1 - 200
[timestamp] GET /login?confirmed=1 - 200  (repeated)
```

**Render logs verification:**
- [ ] ✅ Clean flow - only /auth/callback and /account
- [ ] ✅ No repeated `/login?confirmed=1` entries
- [ ] ❌ Still seeing loop pattern in logs

---

## ✅ SUCCESS CRITERIA

**All must be checked for complete success:**

### Template Updates
- [ ] Magic Link template uses conditional fallback
- [ ] Confirm Signup template uses conditional fallback
- [ ] Templates saved in Supabase production
- [ ] Test email sent and verified

### Email Verification
- [ ] Test email received
- [ ] Button href contains Supabase verify URL
- [ ] redirect_to parameter includes /auth/callback
- [ ] No empty href attributes
- [ ] No direct /login?confirmed=1 links

### Infrastructure
- [ ] Cloudflare cache purged for 4 URLs
- [ ] /auth/callback returns 200 (verified with curl)
- [ ] /login returns 200 (verified with curl)
- [ ] /register returns 200 (verified with curl)

### End-to-End Flow
- [ ] Magic link request successful
- [ ] Email received within 30 seconds
- [ ] Link clickable (not empty href)
- [ ] Lands on /auth/callback#access_token=...
- [ ] Session established (access_token visible in hash)
- [ ] Redirects to /account
- [ ] User authenticated successfully
- [ ] No infinite loops observed
- [ ] Render logs show clean flow

---

## 🔍 How It Works

### Client Code (Already Correct)

**File:** `public/js/auth-send.js`
```javascript
const redirectUrl = (location.origin === 'http://localhost:10000')
  ? 'http://localhost:10000/auth/callback'
  : 'https://booklantern.org/auth/callback';

await sb.auth.signInWithOtp({ 
  email, 
  options: { emailRedirectTo: redirectUrl } 
});
```

### Supabase Template Processing

```
1. Client sends magic link request with emailRedirectTo
   ↓
2. Supabase creates verification URL:
   https://PROJECT.supabase.co/auth/v1/verify?token=ABC123&redirect_to=https://booklantern.org/auth/callback
   ↓
3. Template conditional evaluates:
   {{ if .ActionURL }} → TRUE (ActionURL exists)
   Uses: {{ .ActionURL }} (the full verification URL)
   ↓
4. Email button generated with correct href
```

### User Click Flow

```
User clicks button in email
  ↓
Browser → https://PROJECT.supabase.co/auth/v1/verify?token=...&redirect_to=https://booklantern.org/auth/callback
  ↓
Supabase verifies token (valid/invalid check)
  ↓
302 Redirect → https://booklantern.org/auth/callback#access_token=XYZ&refresh_token=ABC
  ↓
auth-bridge.js detects hash on /auth/callback
  ↓
Calls: supabase.auth.setSession({ access_token, refresh_token })
  ↓
Session established
  ↓
Redirects → /account
  ↓
✅ USER AUTHENTICATED
```

---

## 🎯 Before vs After

### ❌ BEFORE (Broken)

**Template:**
```html
<a href="{{ .SiteURL }}/login?confirmed=1">Sign in</a>
```

**Generated link:**
```
https://booklantern.org/login?confirmed=1
```

**Result:**
- No Supabase token verification
- No tokens in URL
- Lands on page with no session
- Infinite loop

### ✅ AFTER (Fixed)

**Template:**
```html
<a href="{{ if .ActionURL }}{{ .ActionURL }}{{ else }}{{ .ConfirmationURL }}{{ end }}">Sign in</a>
```

**Generated link:**
```
https://PROJECT.supabase.co/auth/v1/verify?token=abc123...&redirect_to=https://booklantern.org/auth/callback
```

**Result:**
- Supabase verifies token
- Redirects with tokens in hash fragment
- Session established
- User authenticated
- Success!

---

## 📞 Troubleshooting

### Issue: Test email has empty href

**Cause:** Template syntax error  
**Fix:** 
1. Re-edit template in Supabase
2. Verify conditional is exact: `{{ if .ActionURL }}{{ .ActionURL }}{{ else }}{{ .ConfirmationURL }}{{ end }}`
3. Check for typos, missing spaces, or extra characters
4. Save and send new test email

---

### Issue: Still landing on /login?confirmed=1

**Cause:** Using old email sent before template update  
**Fix:** 
1. Request FRESH magic link AFTER saving template
2. Do NOT reuse old emails from inbox
3. Wait 60 seconds after template save
4. Use incognito window for clean test

---

### Issue: Still seeing loops after template update

**Possible causes:**
1. Cloudflare cache not purged
2. Using old email
3. Template didn't save correctly
4. Browser has cached JavaScript

**Fixes:**
1. Purge Cloudflare cache for /auth/callback (most common)
2. Request new magic link (don't use old email)
3. Re-edit template and verify conditional is present
4. Hard refresh browser (Ctrl+Shift+R or Cmd+Shift+R)
5. Use incognito window

---

### Issue: /auth/callback still returns 302

**Cause:** Cloudflare cache serving stale response  
**Fix:**
1. Go to Cloudflare Dashboard
2. Caching → Configuration → Custom Purge
3. Purge: https://booklantern.org/auth/callback
4. Wait 30 seconds
5. Test with curl: `curl -sI https://booklantern.org/auth/callback | head -1`
6. Should see: `HTTP/2 200`

---

## 📝 Final Verification Checklist

**Before declaring success:**
- [ ] Templates updated in Supabase Dashboard
- [ ] Test email sent and href verified
- [ ] Cloudflare cache purged
- [ ] Waited 60 seconds after all changes
- [ ] Used incognito window for testing
- [ ] Requested FRESH magic link (new email)
- [ ] Verified email link format before clicking
- [ ] Opened DevTools Network tab
- [ ] Clicked magic link
- [ ] Observed redirect sequence
- [ ] Landed on /account authenticated
- [ ] Checked Render logs (no loops)
- [ ] Documented all results above

---

## 🎯 Expected Final Outcome

After completing all steps:

✅ Supabase email templates use conditional fallback  
✅ Test emails contain working verification URLs  
✅ Magic links are clickable (not empty href)  
✅ Clicking link verifies token at Supabase  
✅ Redirects to /auth/callback with tokens in hash  
✅ Session established automatically  
✅ User lands on /account authenticated  
✅ No infinite loops  
✅ Clean Render logs  
✅ Hash fragments preserved throughout flow  

---

## 📅 Implementation Sign-Off

**Implemented by:** _______________  
**Date:** ___/___/___  
**Time:** __:__ AM/PM  

**Test Result:**
- [ ] ✅ PASS - All success criteria met
- [ ] ❌ FAIL - Issues remain (document below)

**Notes:**
```
_______________________________________________________
_______________________________________________________
_______________________________________________________
```

**Issues encountered (if any):**
```
_______________________________________________________
_______________________________________________________
_______________________________________________________
```

**Resolution (if issues found):**
```
_______________________________________________________
_______________________________________________________
_______________________________________________________
```

---

**Documentation Version:** 1.0  
**Created:** November 10, 2025  
**Status:** Ready for implementation  
**Estimated Time:** 15 minutes  
**Risk Level:** Low (conditional provides fallback)

---

## 🔬 Smoke Test Results - November 10, 2025 12:02 UTC

### Code Deployment Status

**Commit:** cb46ed8  
**Message:** fix(auth): force redirect_to=/auth/callback and hard bridge  
**Deployed to:** main branch  
**Timestamp:** November 10, 2025 12:01 UTC

**Changes Applied:**
- ✅ `auth-send.js` - Updated to use `window.location.origin` for emailRedirectTo
- ✅ `auth-bridge.js` - Added immediate hash detection on page load
- ✅ Routes verified - /auth, /login, /register all serve with 200 (no redirects)

---

### Route Status Test

```bash
=== Route status ===
/auth           HTTP/2 200 ✅
/auth/callback  HTTP/2 302 ⚠️ STALE CACHE - NEEDS PURGE
/login          HTTP/2 200 ✅
/register       HTTP/2 200 ✅
```

**Analysis:**
- ✅ `/auth` returns 200 - serving auth.ejs directly
- ✅ `/login` returns 200 - serving auth.ejs directly (no redirect)
- ✅ `/register` returns 200 - serving auth.ejs directly (no redirect)
- ⚠️ `/auth/callback` returns 302 - **STALE CLOUDFLARE CACHE** (should be 200)

---

### JavaScript Cache Headers

```bash
=== JS cache headers (ensure fresh) ===
/public/js/auth-send.js     cache-control: public, max-age=31536000, immutable
/public/js/auth-bridge.js   cache-control: public, max-age=31536000, immutable
```

**Analysis:**
- ⚠️ Both JS files have immutable cache headers (1 year cache)
- ⚠️ Cloudflare likely serving OLD versions of these files
- **Action required:** Purge Cloudflare cache for both JS files

---

### 🚨 CRITICAL: Cloudflare Cache Purge Required

**URLs that MUST be purged:**

1. **https://booklantern.org/auth/callback** (CRITICAL - still serving 302)
2. **https://booklantern.org/public/js/auth-send.js** (updated code)
3. **https://booklantern.org/public/js/auth-bridge.js** (updated code)
4. **https://booklantern.org/auth** (preventive)
5. **https://booklantern.org/login** (preventive)
6. **https://booklantern.org/register** (preventive)

**How to purge:**

1. Navigate to: https://dash.cloudflare.com
2. Select **booklantern.org** domain
3. Click **Caching** → **Configuration**
4. Click **Custom Purge** → **Purge by URL**
5. Paste the 6 URLs above (one per line)
6. Click **Purge**

**Alternative: Development Mode**
- Caching → Configuration → Toggle **Development Mode** ON
- Wait 3 hours (or toggle off after testing)

---

### Verification After Cache Purge

Run this command after purging:

```bash
curl -sI https://booklantern.org/auth/callback | head -1
```

**Expected:** `HTTP/2 200`  
**Current:** `HTTP/2 302` (stale cache)

---

### Next Steps

**Immediate (BLOCKING):**
- [ ] **Purge Cloudflare cache** for 6 URLs listed above
- [ ] **Verify /auth/callback returns 200** after purge
- [ ] **Wait 60 seconds** after purge

**After Cache Purge:**
- [ ] Update Supabase email templates (see steps above)
- [ ] Send test email and verify href format
- [ ] Request FRESH magic link in incognito window
- [ ] Test full authentication flow
- [ ] Document results below

---

