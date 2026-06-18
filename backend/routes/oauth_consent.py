"""OAuth login + consent page: /oauth/consent.

The MCP client redirects the user's browser here. They log in with their ZET
credentials (email/password OR Microsoft) and approve; we issue the authorization
code and redirect back to the client."""

from fastapi import APIRouter, Depends, Form
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database.database import get_db
from logic import auth_logic
from logic.schemas import LoginBody, MicrosoftAuthBody
from oauth_provider import oauth_provider

router = APIRouter()

# Microsoft is offered when the backend has a client id configured (it does by default).
_MS_CLIENT_ID = auth_logic.MICROSOFT_CLIENT_ID
_MS_AUTHORITY = f"https://login.microsoftonline.com/{auth_logic.MICROSOFT_TENANT_ID or 'common'}"


def _page(request_id: str, app_name: str, error: str = "") -> str:
    err = f'<p class="err">{error}</p>' if error else ""
    safe_app = (app_name or "An application").replace("<", "&lt;")
    ms_block = ""
    if _MS_CLIENT_ID:
        ms_block = """
    <div class="divider"><span>or</span></div>
    <button type="button" id="msBtn" class="ms">Sign in with Microsoft</button>
    <p class="hint">Microsoft sign-in works only for accounts that already exist in ZET.</p>
    <script src="https://cdn.jsdelivr.net/npm/@azure/msal-browser@3/lib/msal-browser.min.js"></script>
    <script>
    (function(){
      var btn=document.getElementById('msBtn');
      if(!btn) return;
      var pca=new msal.PublicClientApplication({auth:{
        clientId:"__MS_CLIENT_ID__",
        authority:"__MS_AUTHORITY__",
        redirectUri:window.location.origin+"/oauth/msal-callback"
      }});
      btn.addEventListener('click', async function(){
        btn.disabled=true; btn.textContent='Signing in…';
        try{
          await pca.initialize();
          var res=await pca.loginPopup({scopes:["openid","profile","email"],prompt:"select_account"});
          var r=await fetch("/oauth/consent/microsoft",{method:"POST",headers:{"Content-Type":"application/json"},
            body:JSON.stringify({request_id:"__REQUEST_ID__",id_token:res.idToken})});
          var data=await r.json();
          if(r.ok && data.redirect){ window.location.href=data.redirect; }
          else { throw new Error(data.detail||data.error||"Microsoft sign-in failed"); }
        }catch(e){
          btn.disabled=false; btn.textContent='Sign in with Microsoft';
          var p=document.getElementById('msErr'); if(p){ p.textContent=(e&&e.message)||'Microsoft sign-in failed'; }
        }
      });
    })();
    </script>
    <p class="err" id="msErr"></p>
"""
        ms_block = (ms_block
                    .replace("__MS_CLIENT_ID__", _MS_CLIENT_ID)
                    .replace("__MS_AUTHORITY__", _MS_AUTHORITY)
                    .replace("__REQUEST_ID__", request_id))
    return f"""<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Authorize · ZET</title>
<style>
  body{{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0b0b0f;color:#e7e7ea;
       display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}}
  .card{{width:360px;max-width:92vw;background:#15151b;border:1px solid #26262e;border-radius:18px;padding:28px}}
  h1{{font-size:18px;margin:0 0 4px}} p.sub{{color:#9a9aa5;font-size:13px;margin:0 0 20px}}
  .app{{color:#a78bfa;font-weight:700}}
  label{{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#8a8a95;margin:14px 0 6px}}
  input{{width:100%;box-sizing:border-box;background:#0f0f14;border:1px solid #2a2a33;border-radius:11px;
         padding:11px 13px;color:#e7e7ea;font-size:14px}}
  button{{width:100%;margin-top:20px;background:#7c3aed;color:#fff;border:0;border-radius:11px;
          padding:12px;font-size:14px;font-weight:700;cursor:pointer}}
  button:hover{{opacity:.92}} button:disabled{{opacity:.5;cursor:default}}
  button.ms{{margin-top:0;background:#2a2a33}}
  .err{{color:#e5484d;font-size:13px;margin:10px 0 0}}
  .hint{{color:#6f6f7a;font-size:11px;margin:8px 0 0}}
  .divider{{display:flex;align-items:center;gap:10px;color:#6f6f7a;font-size:11px;margin:18px 0 14px}}
  .divider:before,.divider:after{{content:"";flex:1;height:1px;background:#26262e}}
</style></head><body>
  <div class="card">
    <h1>Authorize access</h1>
    <p class="sub"><span class="app">{safe_app}</span> wants to access your ZET account. Log in to allow it.</p>
    {err}
    <form method="post" action="/oauth/consent">
      <input type="hidden" name="request_id" value="{request_id}">
      <label>Email</label>
      <input name="email" type="email" autocomplete="username" autofocus required>
      <label>Password</label>
      <input name="password" type="password" autocomplete="current-password" required>
      <button type="submit">Log in &amp; authorize</button>
    </form>
    {ms_block}
  </div>
</body></html>"""


@router.get("/consent", response_class=HTMLResponse)
def consent_page(request_id: str):
    name = oauth_provider.pending_client_name(request_id)
    if not name:
        return HTMLResponse("<h2>This authorization request has expired. Start again from your client.</h2>", status_code=400)
    return HTMLResponse(_page(request_id, name))


@router.post("/consent")
def consent_submit(
    request_id: str = Form(...),
    email: str = Form(...),
    password: str = Form(...),
    db: Session = Depends(get_db),
):
    name = oauth_provider.pending_client_name(request_id) or "the application"
    try:
        resp = auth_logic.login(db, LoginBody(email=email, password=password))
    except Exception:
        return HTMLResponse(_page(request_id, name, error="Invalid email or password."), status_code=401)
    try:
        redirect_url = oauth_provider.complete_authorization(request_id, resp.user.id)
    except ValueError as e:
        return HTMLResponse(f"<h2>{e}</h2>", status_code=400)
    return RedirectResponse(redirect_url, status_code=302)


class _MsConsentBody(BaseModel):
    request_id: str
    id_token: str


@router.post("/consent/microsoft")
def consent_microsoft(body: _MsConsentBody, db: Session = Depends(get_db)):
    """Validate a Microsoft id_token, then complete the OAuth authorization. Returns
    the client redirect URL for the browser to follow."""
    try:
        resp = auth_logic.microsoft_auth(db, MicrosoftAuthBody(id_token=body.id_token))
    except Exception as e:
        detail = getattr(e, "detail", None) or str(e)
        if "no_account" in str(detail):
            detail = "No ZET account is linked to this Microsoft user."
        return JSONResponse({"error": detail}, status_code=401)
    try:
        redirect_url = oauth_provider.complete_authorization(body.request_id, resp.user.id)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    return JSONResponse({"redirect": redirect_url})


@router.get("/msal-callback", response_class=HTMLResponse)
def msal_callback():
    """Redirect target for the MSAL popup — loads MSAL so the popup resolves and closes."""
    return HTMLResponse(
        '<!doctype html><html><body><script '
        'src="https://cdn.jsdelivr.net/npm/@azure/msal-browser@3/lib/msal-browser.min.js"></script>'
        '<script>new msal.PublicClientApplication({auth:{clientId:"' + _MS_CLIENT_ID + '"}})'
        '.initialize().then(function(p){return p.handleRedirectPromise();});</script>'
        '<p>Completing sign-in…</p></body></html>'
    )
