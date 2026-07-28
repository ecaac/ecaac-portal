window.initPortal = function(){
  if (window.__portalInited) return;
  window.__portalInited = true;
  var views = document.querySelectorAll('.view');
  var links = document.querySelectorAll('.side-link[data-view]');
  var sidebar = document.getElementById('sidebar');
  var scrim = document.getElementById('scrim');

  // ===== opening a dialog shouldn't summon the on-screen keyboard =====
  //
  // Every dialog here used to focus its first text field the instant it opened.
  // On a desktop that's a convenience — you open "Add aquarium" and start typing
  // the name. On a phone it forces the keyboard up before the member has read a
  // word of the form, covering half the dialog and reflowing what's left.
  //
  // The fix is NOT to delete the focus calls. Focus has a real job in a dialog:
  // it moves the keyboard-navigation point inside, so Tab stays within the form
  // and screen readers announce it. Deleting it would strand those users outside
  // the thing they just opened. Instead, on touch devices focus lands on the
  // dialog's close button — focus still enters the dialog, but a <button> never
  // raises the keyboard. Devices with a real pointer keep the old behaviour
  // unchanged.
  //
  // Detection is on pointer type, not screen width: a small window on a laptop
  // still has a physical keyboard and should still autofocus, while a large
  // tablet shouldn't.
  var COARSE_POINTER = (function(){
    try {
      if (window.matchMedia) return window.matchMedia('(pointer: coarse)').matches;
    } catch (e) {}
    return ('ontouchstart' in window);
  })();

  // el     — the field that would have been focused
  // dialog — the modal it lives in, if any. Omit for inline forms, where the
  //          right touch behaviour is to focus nothing at all and leave the
  //          member looking at the form the scroll just brought into view.
  function softFocus(el, dialog){
    if (!el) return;
    var target = el;
    if (COARSE_POINTER){
      target = dialog ? dialog.querySelector('.card-modal-close') : null;
      if (!target) return;
    }
    // preventScroll stops the browser jumping the dialog to wherever the focused
    // element happens to be; ignored by older Safari, which is harmless.
    try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
  }

  // Which section is showing is DOM state (a class on .view), and the portal is
  // shown/hidden rather than reloaded. Only the initial page markup marks the
  // dashboard active, so without this a previous session could leave any other
  // section active and the next member would land there. Done directly rather
  // than via show() so it doesn't re-trigger show()'s data loaders on top of the
  // ones that run at the end of init.
  views.forEach(function(v){ v.classList.remove('active'); });
  var dashView = document.getElementById('view-dashboard');
  if (dashView) dashView.classList.add('active');
  links.forEach(function(l){ l.classList.toggle('active', l.getAttribute('data-view') === 'dashboard'); });

  function show(id){
    views.forEach(function(v){ v.classList.remove('active'); });
    var target = document.getElementById('view-' + id);
    if (target) target.classList.add('active');
    links.forEach(function(l){ l.classList.toggle('active', l.getAttribute('data-view') === id); });
    // tank detail highlights "tanks" in the nav
    if (id === 'tank-detail') {
      links.forEach(function(l){ l.classList.toggle('active', l.getAttribute('data-view') === 'tanks'); });
    }
    // The Awards page shows an earned-badge count and badge strip fed by the same
    // computation, so it needs this too — it previously only ran on the Badges view,
    // leaving the Awards card stuck on its login placeholder.
    if ((id === 'badges' || id === 'awards') && typeof renderBadgeCategories === 'function') renderBadgeCategories();
    if (id === 'member-aquariums' && typeof renderMemberAquariums === 'function') renderMemberAquariums();
    if (id === 'admin' && typeof loadAdminAwardQueue === 'function') loadAdminAwardQueue();
    if (id === 'admin' && typeof loadEvents === 'function') loadEvents();
    if (id === 'admin' && typeof loadAdminAuctionList === 'function') loadAdminAuctionList();
    if ((id === 'tanks' || id === 'dashboard') && typeof loadTanksFromDB === 'function') loadTanksFromDB();
    if (id === 'notifications' && typeof window.loadNotifications === 'function') window.loadNotifications();
    sidebar.classList.remove('open'); scrim.classList.remove('show');
    window.scrollTo({top:0, behavior:'smooth'});
    // Last, deliberately: pushRoute reads currentTank for the tank-detail URL, and
    // every caller sets that before calling show(). Skipped automatically when this
    // call is itself the result of a back/forward — see suppressPush below.
    pushRoute(id);
  }

  // ===== routing =====
  //
  // Until now, navigating created no history entry at all, so the phone's back
  // button left the site from whichever section you happened to be in. Each view
  // now gets a URL (#/tanks, #/awards, #/tank/<id>) pushed onto the history stack,
  // and a popstate handler puts the matching view back.
  //
  // Hash routing rather than path routing: #/tanks works on any static host with
  // no server config, where /tanks would need every unknown path rewritten to
  // index.html. This file is uploaded to a host by hand, so zero config wins.
  //
  // The listener is registered inside initPortal, which is guarded to run exactly
  // once per page load — registering it at file scope would stack a second handler
  // on top of the first if init were ever re-entered, the shape of bug #4.

  var ROUTABLE = {};
  views.forEach(function(v){ ROUTABLE[v.id.replace(/^view-/, '')] = true; });

  var suppressPush = false;  // true while restoring a view from history
  var pendingTankKey = null; // a tank deep-linked before the tanks array had loaded

  // Live tanks carry the database uuid; demo tanks are an anonymous literal array
  // with no id at all, so they're addressed positionally as i0/i1/i2. Demo data is
  // static and identical on every load, so a positional key is stable there in a
  // way it would never be for live rows that refetch and reorder.
  function tankRouteKey(i){
    var t = tanks[i];
    if (!t) return null;
    return t.id ? String(t.id) : ('i' + i);
  }
  function tankIndexFromKey(key){
    if (!key) return -1;
    if (/^i\d+$/.test(key)) {
      var n = parseInt(key.slice(1), 10);
      return (n >= 0 && n < tanks.length) ? n : -1;
    }
    for (var i = 0; i < tanks.length; i++) {
      if (tanks[i] && String(tanks[i].id) === key) return i;
    }
    return -1;
  }

  function routeFor(id){
    if (id === 'tank-detail') {
      var k = tankRouteKey(currentTank);
      return k ? '#/tank/' + k : '#/tanks';
    }
    return '#/' + id;
  }

  function parseHash(){
    var h = String(window.location.hash || '').replace(/^#\/?/, '');
    if (!h) return { view: 'dashboard', tank: null };
    var parts = h.split('/');
    if (parts[0] === 'tank' && parts[1]) return { view: 'tank-detail', tank: decodeURIComponent(parts[1]) };
    return { view: ROUTABLE[parts[0]] ? parts[0] : 'dashboard', tank: null };
  }

  function pushRoute(id){
    if (suppressPush) return;
    var hash = routeFor(id);
    if (window.location.hash === hash) return; // re-tapping the current nav item shouldn't stack entries
    try {
      history.pushState({ view: id, tank: id === 'tank-detail' ? tankRouteKey(currentTank) : null }, '', hash);
    } catch (e) {
      // No history API (or a file:// origin). Navigation still works exactly as it
      // did before; only the back button is unimproved. Never fatal.
    }
  }

  function replaceRoute(id){
    try {
      history.replaceState({ view: id, tank: id === 'tank-detail' ? tankRouteKey(currentTank) : null }, '', routeFor(id));
    } catch (e) {}
  }

  // Restores a view *from* a URL. Returns the view actually shown, which is not
  // always the one asked for — a deleted tank, or #/admin from a non-admin.
  function applyRoute(id, tankKey){
    var shown = id;
    suppressPush = true;
    try {
      if (id === 'tank-detail') {
        var i = tankIndexFromKey(tankKey);
        if (i >= 0) {
          openTank(i);
        } else if (IS_LIVE && tanksLoading) {
          // Cold load straight into #/tank/<uuid>: the array is still empty. Park the
          // key and let renderTanks() finish the job once the fetch resolves.
          pendingTankKey = tankKey;
          show('tanks'); shown = 'tanks';
        } else {
          show('tanks'); shown = 'tanks';
        }
      } else if (id === 'admin' && !IS_ADMIN) {
        // IS_ADMIN hides the panel, it doesn't protect it — RLS does that. This isn't
        // a security boundary, it just stops a stale URL showing a member a panel
        // whose every control would be rejected server-side.
        show('dashboard'); shown = 'dashboard';
      } else if (ROUTABLE[id]) {
        show(id);
      } else {
        show('dashboard'); shown = 'dashboard';
      }
    } finally {
      suppressPush = false;
    }
    return shown;
  }

  window.addEventListener('popstate', function(e){
    var id, tankKey = null;
    if (e.state && e.state.view) { id = e.state.view; tankKey = e.state.tank || null; }
    else { var p = parseHash(); id = p.view; tankKey = p.tank; }
    var shown = applyRoute(id, tankKey);
    // If the route couldn't be honoured, correct the URL in place rather than
    // leaving it pointing at a view the member isn't looking at. replaceState, not
    // push — a back press must never require a second back press to escape.
    // pendingTankKey means the tank is still on its way — leave the URL alone so
    // renderTanks() can still resolve it, rather than rewriting it to #/tanks and
    // throwing away the id we're waiting for.
    if (shown !== id && !pendingTankKey) replaceRoute(shown);
  });

  links.forEach(function(l){ l.addEventListener('click', function(){ show(l.getAttribute('data-view')); }); });
  document.querySelectorAll('[data-view-jump]').forEach(function(b){
    b.addEventListener('click', function(){ show(b.getAttribute('data-view-jump')); });
  });

  // mobile sidebar
  document.getElementById('burger').addEventListener('click', function(){
    sidebar.classList.add('open'); scrim.classList.add('show');
  });
  scrim.addEventListener('click', function(){ sidebar.classList.remove('open'); scrim.classList.remove('show'); });

  // toast
  var toast = document.getElementById('toast'); var toastTimer;
  function popToast(msg){
    toast.textContent = msg; toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ toast.classList.remove('show'); }, 2400);
  }
  document.addEventListener('click', function(e){
    var t = e.target.closest('.toastable');
    if (t) popToast(t.getAttribute('data-toast') || 'Done');
  });

  // badge-earned notification bar
  var badgePop = document.getElementById('badge-pop'), badgePopTimer, badgeQueue = [], badgeShowing = false;
  document.getElementById('bp-close').addEventListener('click', hideBadgePop);
  function hideBadgePop(){
    badgePop.classList.remove('show');
    clearTimeout(badgePopTimer);
    badgeShowing = false;
    if (badgeQueue.length) setTimeout(nextBadgePop, 350);
  }
  function nextBadgePop(){
    if (badgeShowing || !badgeQueue.length) return;
    var b = badgeQueue.shift();
    badgeShowing = true;
    document.getElementById('bp-ring').innerHTML = b.icon;
    document.getElementById('bp-ring').style.background = b.ringBg || 'linear-gradient(135deg,var(--leaf),var(--leaf-dark))';
    document.getElementById('bp-kicker').textContent = b.kicker || 'Badge earned';
    document.getElementById('bp-title').textContent = b.title;
    badgePop.classList.add('show');
    clearTimeout(badgePopTimer);
    badgePopTimer = setTimeout(hideBadgePop, 5000);
  }
  function notifyBadge(b){ badgeQueue.push(b); if (!badgeShowing) nextBadgePop(); }
  window.notifyBadge = notifyBadge;

  document.getElementById('logout-link').addEventListener('click', async function(){
    // Hard reload rather than just flipping __portalInited back off. The portal is
    // shown/hidden, never torn down, so re-running initPortal() in the same page
    // would bind all 100+ listeners a second time on top of the previous user's
    // still-live ones — those closures hold the *previous* member's tanks/entries
    // arrays, and the per-init re-entrancy locks (tfSaving, afSubmitting) are
    // separate vars per init, so they can't guard against each other. A reload is
    // the only way to guarantee one init, one set of listeners, one member's data.
    try { await supabase.auth.signOut(); } catch (e) { /* local session is cleared regardless */ }
    // __reloadClean rather than reload: it drops the #/... route first, so signing
    // out of #/tank/<id> doesn't reload the sign-in page still pointed at a view
    // the next person to use this device has no business landing on.
    window.__reloadClean();
  });

  // ===== membership card: view + download =====
  function liveName(cm){
    var n = ((cm.first_name || '') + ' ' + (cm.last_name || '')).trim();
    return n || (cm.email ? cm.email.split('@')[0] : 'Member');
  }
  function liveInitials(cm){
    var n = liveName(cm);
    return n.split(/\s+/).map(function(w){ return w[0]; }).slice(0,2).join('').toUpperCase();
  }
  function nextRenewalDate(){
    // fees due end Feb — next 28 Feb from today
    var now = new Date();
    var y = now.getFullYear() + (now.getMonth() >= 2 ? 1 : 0); // after Feb -> next year
    return new Date(y, 1, 28);
  }
  function fmtShortDate(d){
    return ('0' + d.getDate()).slice(-2) + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()] + ' ' + d.getFullYear();
  }

  // ===== Membership types =====
  // Single source of truth for tiers, pills and annual fees. Adding a future tier
  // means adding one entry here — every display site below reads from this map.
  // Committee members are always Full, so the role line never has to show both.
  // ===== Club details =====
  // One place for the facts that were previously repeated across the markup:
  // venue strings, banking details and the annual fee deadline. Fees themselves
  // live in MEMBER_TYPES below, which is the single source for amounts.
  var CLUB = {
    name: 'Eastern Cape Aquarium & Aquascaping Club',
    venue: 'The Italian Club, 17 Harold Road, Broadwood, Gqeberha',
    venueShort: 'The Italian Club, Broadwood',
    localAreas: 'Gqeberha (PE), Jeffreys Bay, Humansdorp, Uitenhage & Despatch',
    feesDueMonth: 'February',                   // fees due by the end of this month
    foundingYear: 2018,                         // members who joined this year are founding members
    expoDate: '2027-04-22T09:00:00',            // Aquarium Expo — drives the countdown
    bank: {
      name: 'Capitec',
      accountName: 'ECAAC',
      accountNumber: '233 374 1003',
      branchCode: '470010'
    }
  };
  // The year fees are next due: this year until March, then next year.
  function feesDueYear(){
    var now = new Date();
    return now.getMonth() >= 2 ? now.getFullYear() + 1 : now.getFullYear();
  }
  // Founding member: joined in the club's founding year (or earlier, which guards
  // against join dates recorded before the club was formally constituted).
  // Single source of truth — the Recognition badge, the directory cards and the
  // member drawer all call this, so they can never disagree.
  function isFoundingJoinDate(joinDate){
    if (!joinDate) return false;
    var y = new Date(String(joinDate).slice(0, 10) + 'T00:00:00').getFullYear();
    return !isNaN(y) && y <= CLUB.foundingYear;
  }

  var MEMBER_TYPES = {
    'Full': {
      label: 'Full', pill: 'Member', plural: 'Full members', fee: 270,
      note: 'Local household rate — Gqeberha, Jeffreys Bay, Humansdorp, Uitenhage &amp; Despatch.'
    },
    'Country': {
      label: 'Country', pill: 'Country Member', plural: 'Country members', fee: 100,
      note: 'Country member rate — households outside Gqeberha, Jeffreys Bay, Humansdorp, Uitenhage &amp; Despatch.'
    },
    'Scholar': {
      label: 'Scholar', pill: 'Scholar', plural: 'Scholar members', fee: 100,
      note: 'Scholar rate — full member benefits at the reduced scholar fee.'
    },
    // Fee of 0 is what marks a member as non-paying — nothing else keys off the
    // name. Deliberately no link to whoever pays the household fee: the club just
    // needs to know this person owes nothing, so there is no main-member field to
    // keep accurate, and no broken pointer when a main member leaves or is deleted.
    'Family': {
      label: 'Family Member', pill: 'Family Member', plural: 'Family members', fee: 0,
      note: 'Covered by a household membership — no fee payable.'
    }
  };
  // Aliases for values that may already be sitting in the column, or that a
  // future SQL edit might reasonably write. Without this, "Family Member" in the
  // database normalises to "Family member", misses the map, and silently falls
  // back to Full — which would bill a non-paying member R270.
  var MEMBER_TYPE_ALIASES = {
    'family member': 'Family', 'family-member': 'Family', 'familymember': 'Family',
    'family': 'Family', 'household': 'Family'
  };
  function memberTypeKey(raw){
    var s = String(raw || 'Full').trim();
    var alias = MEMBER_TYPE_ALIASES[s.toLowerCase()];
    if (alias) return alias;
    var k = s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    return MEMBER_TYPES[k] ? k : 'Full';
  }
  function memberTypeInfo(raw){ return MEMBER_TYPES[memberTypeKey(raw)]; }
  function memberFee(raw){ return memberTypeInfo(raw).fee; }
  // A zero fee is a different kind of fact from a small fee, so it never renders
  // as "R0.00" — that reads like a billing error, or like a debt of nothing.
  function isNonPaying(raw){ return memberFee(raw) === 0; }
  function feeShort(fee){ return fee ? 'R' + fee : 'No fee'; }
  function feeAmountText(fee){ return fee ? fmtRand(fee) : 'No fee payable'; }

  // ===== Membership status & renewal =====
  // members.status and members.renewal_date were previously never read, so the
  // dashboard and membership cards showed fixed placeholder text to everyone.
  var MEMBER_STATUS = { active:'Active', lapsed:'Lapsed', pending:'Pending', suspended:'Suspended', resigned:'Resigned' };
  function memStatusLabel(raw){
    var k = String(raw || '').trim().toLowerCase();
    return MEMBER_STATUS[k] || (raw ? String(raw).charAt(0).toUpperCase() + String(raw).slice(1) : 'Unknown');
  }
  function renewalDaysLeft(raw){
    if (!raw) return null;
    var d = new Date(String(raw).slice(0, 10) + 'T00:00:00');
    if (isNaN(d.getTime())) return null;
    var today = new Date(); today.setHours(0, 0, 0, 0);
    return Math.round((d - today) / 86400000);
  }
  // The big number: days remaining, or a short word when that reads oddly.
  function renewalDaysText(raw){
    var n = renewalDaysLeft(raw);
    if (n === null) return '—';
    if (n < 0) return 'Overdue';
    if (n === 0) return 'Today';
    return String(n);
  }
  // The supporting line: when the renewal actually falls due.
  function renewalText(raw){
    var n = renewalDaysLeft(raw);
    if (n === null) return '';
    var d = new Date(String(raw).slice(0, 10) + 'T00:00:00');
    var when = d.toLocaleDateString('en-ZA', { day:'numeric', month:'long', year:'numeric' });
    if (n < 0) return 'renewal was due ' + when;
    return 'fees due ' + when;
  }
  function fmtRand(n){ return 'R' + Number(n).toFixed(2); }
  // First segment of the role line: Committee for admins, otherwise the tier.
  // Second segment stays "Full Member" — that's paid-up status, not the tier.
  function memberRoleLine(isAdmin, rawType){
    var key = memberTypeKey(rawType);
    var lead = isAdmin ? 'Committee' : (key === 'Full' ? 'Member' : MEMBER_TYPES[key].label);
    // "Family Member · Full Member" reads as a contradiction, so the paid-up
    // second segment is dropped for family members — they're covered, not paid up.
    if (!isAdmin && key === 'Family') return 'Family Member';
    return lead + ' · Full Member';
  }

  var member;
  if (window.currentMember) {
    var cm = window.currentMember;
    var joined = cm.join_date ? new Date(cm.join_date) : new Date();
    member = {
      name: liveName(cm),
      role: memberRoleLine(cm.role === 'admin', cm.membership_type).toUpperCase(),
      number: cm.membership_number || 'ECAAC-' + String(cm.id || '').substr(0, 6).toUpperCase(),
      type: 'Annual · ' + memberTypeInfo(cm.membership_type).label,
      issued: fmtShortDate(joined),
      expires: fmtShortDate(nextRenewalDate())
    };
  } else {
    member = {
      name:'Judy Nel', role:'CLUB PRESIDENT · FULL MEMBER', number:'ECAAC-0002',
      type:'Annual · Full', issued:'01 Feb 2026', expires:'28 Feb 2027'
    };
  }
  var modal = document.getElementById('card-modal');
  var modalSlot = document.getElementById('modal-card-slot');

  function openCardModal(){
    // clone the card from the membership view, minus its buttons
    var src = document.getElementById('ms-card');
    var clone = src.cloneNode(true);
    clone.removeAttribute('id');
    var btnRow = clone.querySelector('div[style*="margin-top:20px"]');
    if (btnRow) btnRow.remove();
    modalSlot.replaceWith(clone);
    clone.id = 'modal-card-slot';
    modalSlot = clone;
    modal.classList.add('show');
    document.getElementById('card-modal-close').focus();
  }
  function closeCardModal(){ modal.classList.remove('show'); }

  var viewBtn = document.getElementById('card-view-btn');
  if (viewBtn) viewBtn.addEventListener('click', openCardModal);
  document.getElementById('card-modal-close').addEventListener('click', closeCardModal);
  modal.addEventListener('click', function(e){ if (e.target === modal) closeCardModal(); });
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') closeCardModal(); });
  document.getElementById('card-modal-print').addEventListener('click', function(){ window.print(); });

  // QR block layout mirrored from the on-page SVG (21×21 grid)
  var qrRects = [[9,1,1,1],[11,0,1,2],[9,3,2,1],[12,3,1,2],[9,6,1,1],[11,5,1,1],
    [1,9,1,1],[3,9,2,1],[6,9,1,2],[0,11,1,1],[2,11,1,2],[4,12,2,1],
    [8,8,2,2],[11,9,1,1],[13,8,1,1],[9,11,1,2],[11,12,2,1],[12,10,1,1],
    [15,9,1,1],[17,8,1,2],[19,9,2,1],[16,11,2,1],[19,12,1,1],[14,12,1,1],
    [9,14,1,1],[11,15,2,1],[9,17,2,1],[12,18,1,2],[10,19,1,1],
    [14,15,2,1],[17,14,1,1],[19,15,1,2],[15,17,1,2],[17,18,2,1],[19,19,1,1]];

  function drawFinder(ctx, x, y, m){
    ctx.strokeStyle = '#0D1026'; ctx.lineWidth = m * 1.1;
    ctx.strokeRect(x + m*0.55, y + m*0.55, m*5.9, m*5.9);
    ctx.fillStyle = '#0D1026';
    ctx.fillRect(x + m*2, y + m*2, m*3, m*3);
  }

  function drawCard(scale, logoImg){
    var W = 1000 * scale, H = 600 * scale;
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var ctx = c.getContext('2d');
    var s = scale;

    // background gradient (matches --deep radial card)
    var g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#142542'); g.addColorStop(0.5, '#0D1026'); g.addColorStop(1, '#06070F');
    ctx.fillStyle = g; roundRect(ctx, 0, 0, W, H, 36*s); ctx.fill();

    // soft green glow top-right
    var glow = ctx.createRadialGradient(W*0.9, H*0.05, 0, W*0.9, H*0.05, 260*s);
    glow.addColorStop(0, 'rgba(143,217,161,0.16)'); glow.addColorStop(1, 'rgba(143,217,161,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

    // brand badge
    var bx = 56*s, by = 52*s, bs = 66*s;
    var bg2 = ctx.createLinearGradient(bx, by, bx+bs, by+bs);
    bg2.addColorStop(0, '#171B3D'); bg2.addColorStop(1, '#06070F');
    ctx.fillStyle = bg2; roundRect(ctx, bx, by, bs, bs, 16*s); ctx.fill();
    ctx.strokeStyle = 'rgba(143,217,161,0.35)'; ctx.lineWidth = 1.4*s;
    roundRect(ctx, bx, by, bs, bs, 16*s); ctx.stroke();
    if (logoImg){
      // draw the real club logo, contained within the badge with a little padding
      ctx.save();
      roundRect(ctx, bx, by, bs, bs, 16*s); ctx.clip();
      var pad = bs * 0.12;
      var innerSize = bs - pad * 2;
      var ratio = Math.min(innerSize / logoImg.naturalWidth, innerSize / logoImg.naturalHeight) || 1;
      var iw = logoImg.naturalWidth * ratio, ih = logoImg.naturalHeight * ratio;
      ctx.drawImage(logoImg, bx + (bs - iw) / 2, by + (bs - ih) / 2, iw, ih);
      ctx.restore();
    } else {
      // fallback fish glyph if the logo couldn't be loaded
      ctx.strokeStyle = '#8FD9A1'; ctx.lineWidth = 4.4*s; ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.ellipse(bx+bs*0.5, by+bs*0.5, bs*0.34, bs*0.22, 0, 0, Math.PI*2); ctx.stroke();
      ctx.fillStyle = '#8FD9A1';
      ctx.beginPath(); ctx.arc(bx+bs*0.66, by+bs*0.44, 2.6*s, 0, Math.PI*2); ctx.fill();
    }

    // club name
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '600 ' + 26*s + 'px Fraunces, Georgia, serif';
    ctx.fillText('Eastern Cape Aquarium & Aquascaping Club', bx + bs + 22*s, by + 30*s);
    ctx.fillStyle = '#8FD9A1';
    ctx.font = '700 ' + 14*s + 'px Inter, sans-serif';
    ctx.fillText('O F F I C I A L   M E M B E R   C A R D', bx + bs + 22*s, by + 56*s);

    // member name + role
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '600 ' + 54*s + 'px Fraunces, Georgia, serif';
    ctx.fillText(member.name, 56*s, 240*s);
    ctx.fillStyle = '#8FD9A1';
    ctx.font = '700 ' + 17*s + 'px Inter, sans-serif';
    ctx.fillText(member.role, 56*s, 276*s);

    // meta grid
    var meta = [['MEMBER NO.', member.number], ['TYPE', member.type], ['ISSUED', member.issued], ['EXPIRES', member.expires]];
    meta.forEach(function(m2, i){
      var col = i % 2, rowI = Math.floor(i / 2);
      var mx = 56*s + col * 300*s, my = 340*s + rowI * 86*s;
      ctx.fillStyle = '#8890A8'; ctx.font = '700 ' + 13*s + 'px Inter, sans-serif';
      ctx.fillText(m2[0], mx, my);
      ctx.fillStyle = '#FFFFFF'; ctx.font = '700 ' + 22*s + 'px Inter, sans-serif';
      ctx.fillText(m2[1], mx, my + 30*s);
    });

    // footer strip
    ctx.fillStyle = '#565A72'; ctx.font = '600 ' + 13*s + 'px Inter, sans-serif';
    ctx.fillText('www.ecaac.co.za  ·  Show at sponsor stores for member discounts', 56*s, H - 40*s);

    // QR panel
    var qs = 220*s, qx = W - qs - 56*s, qy = (H - qs)/2 - 20*s;
    ctx.fillStyle = '#FFFFFF'; roundRect(ctx, qx, qy, qs, qs, 20*s); ctx.fill();
    var pad = 20*s, m = (qs - pad*2) / 21, ox = qx + pad, oy = qy + pad;
    drawFinder(ctx, ox, oy, m);
    drawFinder(ctx, ox + m*14, oy, m);
    drawFinder(ctx, ox, oy + m*14, m);
    ctx.fillStyle = '#0D1026';
    qrRects.forEach(function(r){ ctx.fillRect(ox + r[0]*m, oy + r[1]*m, r[2]*m, r[3]*m); });
    ctx.fillStyle = '#565A72'; ctx.font = '700 ' + 12*s + 'px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(member.number, qx + qs/2, qy + qs + 26*s);
    ctx.textAlign = 'left';

    return c;
  }
  function roundRect(ctx, x, y, w, h, r){
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.arcTo(x+w, y, x+w, y+h, r);
    ctx.arcTo(x+w, y+h, x, y+h, r);
    ctx.arcTo(x, y+h, x, y, r);
    ctx.arcTo(x, y, x+w, y, r);
    ctx.closePath();
  }

  function loadLogoImage(){
    return new Promise(function(resolve){
      var img = new Image();
      img.crossOrigin = 'anonymous';
      var settled = false;
      var done = function(result){ if (!settled){ settled = true; resolve(result); } };
      img.onload = function(){ done(img); };
      img.onerror = function(){ done(null); };
      setTimeout(function(){ done(null); }, 2500); // don't block the download if it hangs
      img.src = 'https://www.ecaac.co.za/images/logo.png';
    });
  }

  var cardDownloaded = false;
  function downloadCard(){
    // wait for the display fonts (and try the real logo) so the card renders accurately
    var render = function(logoImg){
      var canvas;
      try {
        canvas = drawCard(2, logoImg); // 2000×1200 export
      } catch (err) {
        canvas = drawCard(2, null); // if the logo tainted the canvas somehow, redraw without it
      }
      var a = document.createElement('a');
      a.download = 'ECAAC-membership-card-' + member.number + '.png';
      try {
        a.href = canvas.toDataURL('image/png');
      } catch (err) {
        canvas = drawCard(2, null);
        a.href = canvas.toDataURL('image/png');
      }
      document.body.appendChild(a); a.click(); a.remove();
      cardDownloaded = true;
      popToast('Membership card downloaded (' + a.download + ')');
      if (window.checkBadgeChanges) window.checkBadgeChanges();
    };
    var fontsReady = (document.fonts && document.fonts.ready)
      ? Promise.all([document.fonts.load('600 54px Fraunces'), document.fonts.load('700 22px Inter')]).catch(function(){})
      : Promise.resolve();
    Promise.all([fontsReady, loadLogoImage()]).then(function(results){ render(results[1]); });
  }
  var dlBtn = document.getElementById('card-download-btn');
  if (dlBtn) dlBtn.addEventListener('click', downloadCard);
  document.getElementById('card-modal-download').addEventListener('click', downloadCard);
  // dashboard card's download button uses the same real download
  document.querySelectorAll('[data-toast="Membership card PDF downloaded"]').forEach(function(b){
    b.classList.remove('toastable');
    b.removeAttribute('data-toast');
    b.addEventListener('click', downloadCard);
  });

  // ===== Add-to-calendar (.ics) =====
  function pad(n){ return String(n).padStart(2,'0'); }
  function icsStamp(dt){
    return dt.getUTCFullYear() + pad(dt.getUTCMonth()+1) + pad(dt.getUTCDate()) + 'T' + pad(dt.getUTCHours()) + pad(dt.getUTCMinutes()) + pad(dt.getUTCSeconds()) + 'Z';
  }
  function icsEscape(s){ return String(s).replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\n/g,'\\n'); }
  function buildICS(events){
    var lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//ECAAC Members Portal//EN','CALSCALE:GREGORIAN'];
    events.forEach(function(e){
      lines.push('BEGIN:VEVENT');
      lines.push('UID:' + e.uid + '@ecaac.co.za');
      lines.push('DTSTAMP:' + icsStamp(new Date()));
      lines.push('DTSTART:' + icsStamp(e.start));
      lines.push('DTEND:' + icsStamp(e.end));
      lines.push('SUMMARY:' + icsEscape(e.title));
      lines.push('LOCATION:' + icsEscape(e.location));
      lines.push('DESCRIPTION:' + icsEscape(e.desc));
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }
  function downloadICSFile(filename, events){
    var blob = new Blob([buildICS(events)], { type: 'text/calendar;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
  }

  var IS_LIVE = !!window.currentMember;
  var MEETINGS = IS_LIVE ? [] : [
    { uid:'ecaac-2026-08-01', title:'ECAAC Monthly Club Meeting', date:new Date(2026,7,1,14,0), hours:4,
      location:'The Italian Club, 17 Harold Road, Broadwood, Gqeberha',
      desc:'Talks, braai & refreshments, raffle and club auction — anyone may bid.',
      dateLabel:['1','Aug'], name:'Monthly club meeting', meta:'Sat 14:00–18:00 · The Italian Club, Broadwood · talks, braai, raffle & club auction', rsvp:true },
    { uid:'ecaac-2026-08-22', title:'ECAAC Aquascaping Workshop', date:new Date(2026,7,22,10,0), hours:3,
      location:'Venue to be confirmed, Gqeberha',
      desc:'Hardscape composition with Iwagumi principles — bring your own stone.',
      dateLabel:['22','Aug'], name:'Aquascaping workshop', meta:'10:00 · Hardscape composition with Iwagumi principles · bring your own stone', rsvp:true },
    { uid:'ecaac-2026-09-05', title:'ECAAC Monthly Meeting & Spring Auction', date:new Date(2026,8,5,14,0), hours:4,
      location:'The Italian Club, 17 Harold Road, Broadwood, Gqeberha',
      desc:'Member livestock, plants and dry goods — sellers register from mid-August.',
      dateLabel:['5','Sep'], name:'Monthly meeting & spring auction', meta:'Sat 14:00–18:00 · The Italian Club · member livestock, plants and dry goods — sellers register from mid-August', rsvp:false },
    { uid:'ecaac-2026-10-03', title:'ECAAC Monthly Club Meeting', date:new Date(2026,9,3,14,0), hours:4,
      location:'The Italian Club, 17 Harold Road, Broadwood, Gqeberha',
      desc:'Monthly meeting — full program, braai and club auction.',
      dateLabel:['3','Oct'], name:'Monthly club meeting', meta:'Sat 14:00–18:00 · The Italian Club, Broadwood', rsvp:false },
    { uid:'ecaac-2026-11-07', title:'ECAAC Monthly Club Meeting', date:new Date(2026,10,7,14,0), hours:4,
      location:'The Italian Club, 17 Harold Road, Broadwood, Gqeberha',
      desc:'Monthly meeting — full program, braai and club auction.',
      dateLabel:['7','Nov'], name:'Monthly club meeting', meta:'Sat 14:00–18:00 · The Italian Club, Broadwood', rsvp:false }
  ];

  function meetingToEvent(m){
    var end = new Date(m.date.getTime() + m.hours * 3600000);
    return { uid:m.uid, title:m.title, start:m.date, end:end, location:m.location, desc:m.desc };
  }

  function eventRowHtml(m, originalIndex, isPast, isNext){
    var action;
    if (isPast) action = '<span class="badge info">Past</span>';
    else if (isNext) action = '<span class="badge ok">Soon</span>';
    else action = '<span class="badge pend">Upcoming</span>';
    var icsButton = isPast ? '' :
      '<button class="ics-btn" data-mtg="' + originalIndex + '" title="Add to calendar" aria-label="Add ' + escT(m.name) + ' to calendar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M12 14v4M10 16h4"/></svg></button>';
    return '<div class="row"' + (isPast ? ' style="opacity:.7"' : '') + '><div class="event-date"><b>' + m.dateLabel[0] + '</b><span>' + m.dateLabel[1] + '</span></div>' +
      '<div class="row-body"><b>' + escT(m.name) + '</b><span>' + escT(m.meta) + '</span></div>' +
      '<div class="row-actions">' + icsButton + action + '</div></div>';
  }

  // Expo countdown. Previously three hardcoded numbers that never moved; now
  // derived from CLUB.expoDate and refreshed every 30s so it stays honest while
  // the page is open.
  function renderExpoCountdown(){
    var dEl = document.getElementById('cd-days');
    var hEl = document.getElementById('cd-hours');
    var mEl = document.getElementById('cd-mins');
    if (!dEl || !hEl || !mEl) return;
    var target = new Date(CLUB.expoDate);
    if (isNaN(target.getTime())){ dEl.textContent = hEl.textContent = mEl.textContent = '—'; return; }
    var ms = target - new Date();
    if (ms <= 0){
      // Expo day (or past): don't show negative numbers.
      dEl.textContent = '0'; hEl.textContent = '0'; mEl.textContent = '0';
      return;
    }
    var mins = Math.floor(ms / 60000);
    dEl.textContent = Math.floor(mins / 1440);
    hEl.textContent = Math.floor((mins % 1440) / 60);
    mEl.textContent = mins % 60;
  }
  renderExpoCountdown();
  setInterval(renderExpoCountdown, 30000);

  // Dashboard "Next meeting" card. Previously hardcoded to "1 Aug · The Italian
  // Club" even though MEETINGS already held the real schedule.
  function renderNextMeeting(){
    var numEl = document.getElementById('dash-next-date');
    var lblEl = document.getElementById('dash-next-label');
    if (!numEl || !lblEl) return;
    var now = new Date();
    var next = MEETINGS.filter(function(m){ return m.date >= now; })
      .sort(function(a, b){ return a.date - b.date; })[0];
    if (!next){
      numEl.textContent = '—';
      lblEl.textContent = IS_LIVE ? 'No upcoming events yet' : 'No upcoming events';
      return;
    }
    numEl.textContent = next.dateLabel[0] + ' ' + next.dateLabel[1];
    var bits = [next.date.toLocaleDateString('en-ZA', { weekday:'short' }) + ' ' +
                next.date.toLocaleTimeString('en-ZA', { hour:'2-digit', minute:'2-digit', hour12:false })];
    if (next.location) bits.push(next.location);
    lblEl.textContent = next.name + ' · ' + bits.join(' · ');
  }

  // Dashboard "Upcoming events" preview — the next three real events, same pill
  // vocabulary as the Events view. Kept independent of renderEvents' own guards
  // so it still renders on views where #events-rows isn't present.
  function renderDashEvents(){
    var dash = document.getElementById('dash-events');
    if (!dash) return;
    var now = new Date();
    var upcoming = MEETINGS
      .filter(function(m){ return m.date >= now; })
      .sort(function(a, b){ return a.date - b.date; })
      .slice(0, 3);
    if (!upcoming.length){
      dash.innerHTML = '<div class="reg-empty" style="padding:20px">' +
        (IS_LIVE ? 'No events on the calendar yet — the committee will post the next one soon.' : 'No events yet.') +
        '</div>';
      return;
    }
    dash.innerHTML = upcoming.map(function(m, i){
      var pill = i === 0
        ? '<span class="badge ok">Soon</span>'
        : '<span class="badge pend">Upcoming</span>';
      return '<div class="row"><div class="event-date"><b>' + m.dateLabel[0] + '</b><span>' + m.dateLabel[1] + '</span></div>' +
        '<div class="row-body"><b>' + escT(m.name) + '</b><span>' + escT(m.meta) + '</span></div>' +
        '<div class="row-actions">' + pill + '</div></div>';
    }).join('');
  }

  function renderEvents(){
    renderDashEvents();
    renderNextMeeting();
    var el = document.getElementById('events-rows');
    var pastEl = document.getElementById('events-past-rows');
    if (!el) return;
    if (!MEETINGS.length){
      var msg = '<div class="reg-empty" style="padding:22px">' + (IS_LIVE ? 'No events on the calendar yet — the committee will post the next one soon.' : 'No events yet.') + '</div>';
      el.innerHTML = msg;
      if (pastEl) pastEl.innerHTML = '<div class="reg-empty" style="padding:22px">Nothing here yet.</div>';
      return;
    }
    var now = new Date();
    var withIdx = MEETINGS.map(function(m, i){ return { m: m, i: i }; });
    var upcoming = withIdx.filter(function(x){ return x.m.date >= now; }).sort(function(a,b){ return a.m.date - b.m.date; });
    var past = withIdx.filter(function(x){ return x.m.date < now; }).sort(function(a,b){ return b.m.date - a.m.date; });

    el.innerHTML = upcoming.length
      ? upcoming.map(function(x, ui){ return eventRowHtml(x.m, x.i, false, ui === 0); }).join('')
      : '<div class="reg-empty" style="padding:22px">Nothing on the calendar yet — check back soon.</div>';

    if (pastEl){
      pastEl.innerHTML = past.length
        ? past.map(function(x){ return eventRowHtml(x.m, x.i, true); }).join('')
        : '<div class="reg-empty" style="padding:22px">No past events recorded yet.</div>';
    }

    document.querySelectorAll('.ics-btn').forEach(function(b){
      b.addEventListener('click', function(){
        var m = MEETINGS[parseInt(b.getAttribute('data-mtg'),10)];
        downloadICSFile('ECAAC-' + m.uid + '.ics', [meetingToEvent(m)]);
        popToast(m.name + ' added to your calendar file');
      });
    });
  }
  renderEvents();

  var icsAllBtn = document.getElementById('ics-all-btn');
  if (icsAllBtn) icsAllBtn.addEventListener('click', function(){
    var now = new Date();
    var upcomingOnly = MEETINGS.filter(function(m){ return m.date >= now; });
    downloadICSFile('ECAAC-meetings-2026.ics', upcomingOnly.map(meetingToEvent));
    popToast('All ' + upcomingOnly.length + ' upcoming meetings added to your calendar file');
  });

  // ===== Club Resources: full guide library (mirrors ecaac.co.za/club-resources) =====
  var GUIDE_EMOJI_FALLBACK = {
    'species-care-guides':'🐟', 'aquatic-plant-care-guide':'🌿', 'live-food-culturing':'🦠', 'nitrogen-cycle':'⚖️',
    'algae-identification-control':'🔬', 'water-quality':'🚰', 'fish-disease':'💊', 'filter-types':'⚖️', 'nano-aquarium-setup':'📏',
    'aquascaping':'🏘️', 'iwagumi-aquascaping':'🪨', 'aquascape-fish':'🐟', 'co2-systems-explained':'💧',
    'aquascaping-substrates-compared':'🪨', 'aquascape-lighting-guide':'💡',
    'blackwater-aquariums':'🌴', 'lake-tanganyika':'🌍', 'saltwater-reef-aquarium':'🐠', 'tropical-bioactive-vivarium':'🐌',
    'lake-malawi':'🐠', 'south-american-dwarf-cichlids':'🐟', 'southeast-asian-biotope':'🏞️', 'killifish':'🌍',
    'west-african-aquariums':'🌴', 'medaka':'🎏'
  };
  var GUIDE_SECTIONS = [
    { num:'01', title:'Care & Maintenance Guides', sub:'The Fundamentals Every Aquarist Needs', guides:[
      { pill:'Care Guide', title:'Species & Care Guides', url:'species-care-guides', img:'species-care-guides.webp', a:'#1B3A2A', b:'#0D1026', desc:"Detailed care requirements for popular fish species in the South African hobby — water parameters, diet, tankmates and more." },
      { pill:'Care Guide', title:'Aquatic Plant Care Guide', url:'aquatic-plant-care-guide', img:'aquatic-plant-care-guide.webp', a:'#1D3B22', b:'#0D1026', desc:'Light, nutrient and placement guidance for popular aquarium plants, from easy beginner species to more demanding carpeting plants.' },
      { pill:'How-To', title:'Live Food Culturing', url:'live-food-culturing', img:'live-food-culturing.webp', a:'#142542', b:'#0D1026', desc:'Cost-effective, easy home cultures for vinegar eels, microworms, daphnia, mosquito larvae and bloodworms.' },
      { pill:'Beginner Guide', title:'The Nitrogen Cycle', url:'nitrogen-cycle', img:'nitrogen-cycle.webp', a:'#0D1026', b:'#171B3D', desc:'A beginner-friendly, visual explanation of how to cycle a new aquarium safely before adding fish.' },
      { pill:'Troubleshooting', title:'Algae Identification & Control', url:'algae-identification-control', img:'algae-identification-control.webp', a:'#3D4814', b:'#0D1026', desc:'Identify common algae types by sight, understand the cause, and treat outbreaks with a clear step-by-step plan.' },
      { pill:'Beginner Guide', title:'Water Quality & SA Tap Water', url:'water-quality', img:'water-quality.webp', a:'#082A3E', b:'#041B2B', desc:'pH, hardness, chloramine, ammonia, nitrate — and what comes out of South African municipal taps, region by region.' },
      { pill:'Troubleshooting', title:'Fish Disease Identification & Treatment', url:'fish-disease', img:'fish-disease.webp', a:'#2A0A0A', b:'#1A0505', desc:'Identify Ich, velvet, fin rot, dropsy, flukes and more by sight — with causes, SA-available treatments, and quarantine protocol.' },
      { pill:'Equipment Guide', title:'Aquarium Filter Types Explained', url:'filter-types', img:'filter-types.webp', a:'#142542', b:'#0A1830', desc:'Sponge, HOB, canister, internal, sump — what each does, when to use it, how to layer media, and how to clean without crashing the cycle.' },
      { pill:'Beginner Guide', title:'Nano Aquarium Setup Guide', url:'nano-aquarium-setup', img:'nano-aquarium-setup.webp', a:'#2A0A20', b:'#15050F', desc:'Equipment, cycling, and realistic stocking for tanks under 40L — plus why shrimp are often the smarter nano choice.' }
    ]},
    { num:'02', title:'Aquascaping', sub:'Layout, CO₂ & the Art of the Underwater Landscape', guides:[
      { pill:'Aquascaping Guide', title:'Aquascaping 101', url:'aquascaping', img:'aquascaping-guide.webp', a:'#0A1D0F', b:'#0F2B15', desc:'Layout styles, CO₂ and plant science, hardscape materials, and the history of the craft — with a South African hobby lens.' },
      { pill:'Craft Guide', title:'Iwagumi Aquascaping', url:'iwagumi-aquascaping', img:'iwagumi-aquascaping.webp', a:'#0F2B15', b:'#0A1D0F', desc:'Stone roles and selection, golden ratio rock placement, and low-tech vs high-tech approaches to the minimalist Japanese stone style.' },
      { pill:'Livestock Guide', title:'Top Freshwater Fish for Aquascapes', url:'aquascape-fish', img:'aquascape-fish.webp', a:'#142542', b:'#0D1026', desc:'Nano schoolers, mid-water showpieces, and the algae-eating cleanup crew — plus stocking rules and species to avoid.' },
      { pill:'Craft Guide', title:'CO₂ Systems Explained', url:'co2-systems-explained', img:'co2-systems-explained.webp', a:'#0A1D0F', b:'#142542', desc:'Pressurised vs DIY yeast CO₂, regulators, bubble counters, and drop checker colours — demystified for planted tanks.' },
      { pill:'Craft Guide', title:'Aquascaping Substrates Compared', url:'aquascaping-substrates-compared', img:'aquascaping-substrates-compared.webp', a:'#3A2C1E', b:'#0D1026', desc:'Aqua soil vs sand vs gravel vs the soil-under-sand method — substrate choice, pH/KH effects, and popular brands.' },
      { pill:'Craft Guide', title:'Aquascape Lighting Guide', url:'aquascape-lighting-guide', img:'aquascape-lighting-guide.webp', a:'#0F2B15', b:'#3D4814', desc:'PAR, spectrum, photoperiod, and matching light intensity to CO₂ and nutrients for a balanced planted tank.' }
    ]},
    { num:'03', title:'Aquariums & Specialty Tanks', sub:'Aquariums and Real Wild Habitats', guides:[
      { pill:'Freshwater', title:'Blackwater Aquariums', url:'blackwater-aquariums', img:'blackwater-biotopes.webp', a:'#2B1B0E', b:'#0D0904', desc:"The Amazon's tea-dark Rio Negro — fish, plants, and the tannin-stained water chemistry that defines it." },
      { pill:'Freshwater', title:'Lake Tanganyika Aquariums', url:'lake-tanganyika', img:'lake-tanganyika-biotope.webp', a:'#082A3E', b:'#041826', desc:"Africa's ancient rift lake — rock and sand-dwelling cichlids, hard alkaline water, and remarkable natural history." },
      { pill:'Saltwater', title:'Saltwater Reef Aquarium', url:'saltwater-reef-aquarium', img:'saltwater-reef-aquarium.webp', a:'#2A1052', b:'#0D0620', desc:'A coral reef in miniature — fish, corals and invertebrates, water chemistry, and the growing SA marine hobby.' },
      { pill:'Terrarium', title:'Tropical Bioactive Vivarium', url:'tropical-bioactive-vivarium', img:'tropical-bioactive-vivarium.webp', a:'#16311B', b:'#071409', desc:'A self-cleaning rainforest floor in miniature — plants, clean-up crew, and the living ecosystem that powers it.' },
      { pill:'Freshwater', title:'Lake Malawi Aquariums', url:'lake-malawi', img:'lake-malawi.webp', a:'#082A3E', b:'#041826', desc:"Africa's rift lake jewel — mbuna and haplochromine cichlids, explosive colour, and fierce rocky-shore territories." },
      { pill:'Freshwater', title:'South American Dwarf Cichlids', url:'south-american-dwarf-cichlids', img:'cockatoo-cichlid.webp', a:'#2B1B0E', b:'#0D0904', desc:'Apistogramma and relatives — tiny, colourful, pair-bonding cichlids for a heavily planted, tannin-stained tank.' },
      { pill:'Freshwater', title:'Southeast Asian Biotope', url:'southeast-asian-biotope', img:'southeast-asian-biotope.webp', a:'#0A2A24', b:'#051510', desc:'Peat swamp forest and fast hillstream habitats — Betta, Rasbora, and the extraordinary hillstream loaches.' },
      { pill:'Freshwater', title:'African Killifish', url:'killifish', img:'killifish.webp', a:'#2B1B0E', b:'#0D0904', desc:'Nothobranchius, Aphyosemion and Fundulopanchax — annual and non-annual life cycles, drought-proof eggs, and breeding basics.' },
      { pill:'Freshwater', title:'West African River Aquariums', url:'west-african-aquariums', img:'west-african-biotope.webp', a:'#0F2B15', b:'#051510', desc:'Brightly coloured fish, true aquatic plants and soft tannin-stained water — a field-guide look at the West African river biotope.' },
      { pill:'Freshwater', title:'Medaka — Japanese Rice Fish', url:'medaka', img:'medaka.webp', a:'#3D0714', b:'#0D0206', desc:"Japan's hardy, endlessly variable rice paddy fish — hundreds of colour strains, outdoor tub culture, and easy breeding." }
    ]}
  ];
  var GUIDE_PILL_BG = {
    'Care Guide':['#EAF3DE','var(--leaf-dark)'], 'How-To':['#FBF0DA','var(--gold-dark)'], 'Beginner Guide':['#E3EBED','var(--deep)'],
    'Troubleshooting':['#FCEBDD','var(--coral-dark)'], 'Equipment Guide':['#E3EBED','var(--deep)'], 'Aquascaping Guide':['#EAF3DE','var(--leaf-dark)'],
    'Craft Guide':['#EAF3DE','var(--leaf-dark)'], 'Livestock Guide':['#FBF0DA','var(--gold-dark)'],
    'Freshwater':['#EAF3DE','var(--leaf-dark)'], 'Saltwater':['#E3EBED','var(--deep)'], 'Terrarium':['#FBF0DA','var(--gold-dark)']
  };

  function normGuide(s){ return String(s).toLowerCase().replace(/₂/g, '2'); }
  function renderGuides(query){
    var q = normGuide(query || '').trim();
    var el = document.getElementById('res-sections');
    var html = '', totalShown = 0, totalAll = 0;
    GUIDE_SECTIONS.forEach(function(sec){ totalAll += sec.guides.length; });
    GUIDE_SECTIONS.forEach(function(sec){
      var matches = sec.guides.filter(function(g){
        return !q || normGuide(g.title + ' ' + g.desc + ' ' + g.pill).indexOf(q) !== -1;
      });
      if (!matches.length) return;
      totalShown += matches.length;
      html += '<div class="res-section-head"><span class="res-num">' + sec.num + '</span><div><h3>' + escT(sec.title) + '</h3><div class="sub">' + escT(sec.sub) + '</div></div></div>';
      html += '<div class="res-cards-grid">';
      html += matches.map(function(g){
        var pillColors = GUIDE_PILL_BG[g.pill] || ['#E3EBED','var(--deep)'];
        var fallback = GUIDE_EMOJI_FALLBACK[g.url] || '🐟';
        return '<a class="res-card" href="https://www.ecaac.co.za/' + g.url + '" target="_blank" rel="noopener">' +
          '<div class="thumb" style="--card-a:' + g.a + ';--card-b:' + g.b + '">' +
          '<img src="https://www.ecaac.co.za/images/' + g.img + '" alt="' + escT(g.title) + '" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
          '<div class="thumb-fallback" style="display:none">' + fallback + '</div>' +
          '<span class="cat-pill" style="background:' + pillColors[0] + ';color:' + pillColors[1] + ';border:none;backdrop-filter:none">' + escT(g.pill) + '</span>' +
          '</div><div class="body"><h4>' + escT(g.title) + '</h4><p>' + escT(g.desc) + '</p>' +
          '<span class="card-link">Read the guide <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg></span></div></a>';
      }).join('');
      html += '</div>';
    });
    el.innerHTML = html;
    document.getElementById('res-empty').style.display = totalShown ? 'none' : 'block';
    var pill = document.getElementById('res-count-pill');
    if (pill && !q) pill.textContent = '📚 ' + totalAll + ' Guides';
  }
  renderGuides('');
  var resSearch = document.getElementById('res-search');
  if (resSearch) resSearch.addEventListener('input', function(){ renderGuides(this.value); });

  // ===== Award entry submission =====
  var ENTRIES = IS_LIVE ? [] : [
    { title:"HAP — Bucephalandra 'Kedagang' (division)", meta:'Emerald Valley · submitted 19 Jul 2026 · awaiting judge photos check', status:'pend', icon:'plant' },
    { title:'BAP — Julidochromis ornatus (spawn)', meta:'Rift Lake Reef · submitted 11 Jul 2026 · fry at 30-day mark 10 Aug', status:'pend', icon:'fish' },
    { title:'BAP — Neolamprologus multifasciatus (spawn)', meta:'Rift Lake Reef · +15 points · judge: "Textbook shell-dweller colony — lovely documentation."', status:'ok', icon:'fish' },
    { title:'AAP — Spring showcase 2026, "Emerald Valley"', meta:'87/100 · 2nd place · +30 points', status:'ok', icon:'scape' },
    { title:'HAP — Cryptocoryne wendtii (runner propagation)', meta:'+10 points · Mar 2026', status:'ok', icon:'plant' }
  ];
  // Live mode fetches entries after init, so the list starts in a loading state
  // (same pattern as tanksLoading). Demo mode already has its rows in hand.
  var entriesLoading = IS_LIVE;
  var entriesError = false;
  var ENTRY_ICONS = {
    fish: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s4-6 12-6 8 6 8 6-2 6-8 6-12-6-12-6Z"/><circle cx="17" cy="10.5" r=".6" fill="currentColor" stroke="none"/></svg>',
    plant: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21V9"/><path d="M12 12c0-4 3-7 7-7 0 4-3 7-7 7Z"/><path d="M12 15c0-4-3-6-7-6 0 4 3 6 7 6Z"/></svg>',
    scape: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 17l5-6 4 4 5-7 4 5"/><path d="M3 20h18"/></svg>'
  };
  function renderEntries(){
    var el = document.getElementById('entries-rows');
    if (!el) return;
    el.innerHTML = ENTRIES.length ? ENTRIES.map(function(e){
      var badgeClass = e.status === 'ok' ? 'ok' : (e.status === 'rej' ? 'warn' : 'pend');
      var badgeLabel = e.status === 'ok' ? 'Approved' : (e.status === 'rej' ? 'Not approved' : 'Pending');
      var iconClass = e.status === 'ok' ? '' : (e.status === 'rej' ? ' warn' : ' gold');
      return '<div class="row"><div class="row-icon' + iconClass + '">' + ENTRY_ICONS[e.icon] + '</div>' +
        '<div class="row-body"><b>' + escT(e.title) + '</b><span>' + escT(e.meta) + '</span>' + awardThumbsHtml(e.photos) + '</div>' +
        '<span class="badge ' + badgeClass + '">' + badgeLabel + '</span></div>';
    }).join('') : '<div class="reg-empty" style="padding:22px">' + (
        entriesLoading ? 'Loading your award entries…'
      : entriesError   ? 'Couldn\u2019t load your entries just now — check your connection and reload the page.'
      : 'No award entries yet — submit your first entry when you have a spawn, plant division or aquascape to show.'
    ) + '</div>';
    wireAwardThumbs(el);
    var pendingCount = ENTRIES.filter(function(e){ return e.status==='pend'; }).length;
    document.getElementById('aw-approved-count').textContent = entriesLoading ? '—' : ENTRIES.filter(function(e){ return e.status==='ok'; }).length;
    document.getElementById('aw-pending-count').textContent = entriesLoading ? '—' : pendingCount;
    refreshAwardStats(pendingCount);
    renderProgramProgress();
  }
  renderEntries();

  var awardModal = document.getElementById('award-modal');
  function populateTankSelect(){
    var sel = document.getElementById('af-tank');
    sel.innerHTML = '<option value="">— Select a tank —</option>' + tanks.map(function(t,i){ return '<option value="' + i + '">' + escT(t.name) + '</option>'; }).join('');
  }
  function openAwardModal(){
    populateTankSelect();
    document.getElementById('af-species').value = '';
    document.getElementById('af-notes').value = '';
    document.getElementById('af-program').value = 'BAP';
    document.getElementById('af-category').value = 'Fish';
    document.getElementById('af-photo').value = '';
    document.getElementById('af-file-text').textContent = 'Tap to choose photos of your entry';
    document.getElementById('af-file-label').classList.remove('has-file');
    document.getElementById('af-error').style.display = 'none';
    var afSt = document.getElementById('af-status'); if (afSt) afSt.textContent = '';
    awardModal.classList.add('show');
    softFocus(document.getElementById('af-species'), awardModal);
  }
  function closeAwardModal(){ awardModal.classList.remove('show'); }
  document.getElementById('award-open-btn').addEventListener('click', openAwardModal);
  document.getElementById('fab-award').addEventListener('click', openAwardModal);
  document.getElementById('award-modal-close').addEventListener('click', closeAwardModal);
  document.getElementById('af-cancel').addEventListener('click', closeAwardModal);
  awardModal.addEventListener('click', function(e){ if (e.target === awardModal) closeAwardModal(); });
  document.getElementById('af-photo').addEventListener('change', function(){
    var n = this.files.length;
    document.getElementById('af-file-text').textContent = n ? (n + ' photo' + (n===1?'':'s') + ' selected') : 'Tap to choose photos of your entry';
    document.getElementById('af-file-label').classList.toggle('has-file', n > 0);
  });
  var afSubmitting = false;
  document.getElementById('af-submit').addEventListener('click', async function(){
    if (afSubmitting) return;
    var species = document.getElementById('af-species').value.trim();
    if (!species){ document.getElementById('af-error').style.display = 'block'; return; }
    afSubmitting = true;
    var program = document.getElementById('af-program').value;
    var category = document.getElementById('af-category').value;
    var tankIdx = document.getElementById('af-tank').value;
    var tankObj = tankIdx !== '' ? tanks[parseInt(tankIdx,10)] : null;
    var submitBtn = document.getElementById('af-submit');
    var afStatus = document.getElementById('af-status');
    var photoFiles = Array.prototype.slice.call(document.getElementById('af-photo').files || []);
    submitBtn.disabled = true; submitBtn.textContent = 'Submitting…';
    if (afStatus) afStatus.textContent = '';

    if (sb && window.currentMember){
      var res = await dbInsertRow('award_entries', {
        member_id: window.currentMember.id,
        tank_id: tankObj ? tankObj.id : null,
        program: program, category: category, species: species,
        notes: document.getElementById('af-notes').value.trim() || null
      });
      if (res.error){
        submitBtn.disabled = false; submitBtn.textContent = 'Submit for judging';
        popToast('Could not submit — try again'); afSubmitting = false; return;
      }
      // Entry is saved from here on. Photos are a best-effort extra: the modal
      // stays open while they upload so there's visible progress, but nothing
      // below can undo the submission.
      var attached = 0;
      if (photoFiles.length && res.data && res.data.id){
        submitBtn.textContent = 'Uploading photos…';
        attached = await uploadAwardPhotos(res.data.id, photoFiles, function(n, total){
          if (afStatus) afStatus.textContent = 'Uploading photo ' + n + ' of ' + total + '…';
        });
      }
      submitBtn.disabled = false; submitBtn.textContent = 'Submit for judging';
      if (afStatus) afStatus.textContent = '';
      closeAwardModal();
      popToast(category + ' entry for ' + program + ' submitted for judging');
      if (photoFiles.length && attached < photoFiles.length){
        popToast(attached
          ? 'Entry saved, but ' + (photoFiles.length - attached) + ' photo(s) didn\u2019t upload'
          : 'Entry saved, but the photos didn\u2019t upload — you can mention this to the committee');
      }
      loadMyEntries();
    } else {
      submitBtn.disabled = false; submitBtn.textContent = 'Submit for judging';
      var metaParts = [];
      if (tankObj) metaParts.push(tankObj.name);
      metaParts.push('submitted ' + todayShort() + ' 2026');
      metaParts.push('awaiting judge review');
      var entry = { title: program + ' — ' + species, meta: metaParts.join(' · '), status:'pend',
        icon: program === 'HAP' ? 'plant' : (program === 'AAP' ? 'scape' : 'fish') };
      ENTRIES.unshift(entry);
      renderEntries();
      if (tankObj){
        tankObj.awards.unshift([program + ' — ' + species, 'Submitted ' + todayShort() + ' 2026', 'pend']);
        if (currentTank === parseInt(tankIdx,10)) renderDetail();
      }
      closeAwardModal();
      popToast(category + ' entry for ' + program + ' submitted for judging');
    }
    if (window.checkBadgeChanges) window.checkBadgeChanges();
    afSubmitting = false;
  });

  // ===== My Auctions =====
  var AUCTIONS = IS_LIVE ? [] : [
    { date:'5 September 2025', item:'Pair of Apistogramma cacatuoides', role:'Bought', amount:180 },
    { date:'5 September 2025', item:'Java fern on driftwood', role:'Bought', amount:60 },
    { date:'4 October 2025', item:'Trio of Corydoras sterbai', role:'Sold', amount:150 },
    { date:'1 November 2025', item:'Fluval canister filter (used)', role:'Bought', amount:420 },
    { date:'6 December 2025', item:'Neolamprologus multifasciatus colony (12)', role:'Sold', amount:360 },
    { date:'7 February 2026', item:'CO₂ regulator with bubble counter', role:'Bought', amount:350 },
    { date:'7 March 2026', item:'Bucephalandra \u2018Kedagang\u2019 clumps (3)', role:'Sold', amount:210 },
    { date:'4 April 2026', item:'Bag of aqua soil, 9L', role:'Bought', amount:145 },
    { date:'2 May 2026', item:'Julidochromis ornatus fry (8)', role:'Sold', amount:240 },
    { date:'6 June 2026', item:'Amazon frogbit, large clump', role:'Bought', amount:35 },
    { date:'4 July 2026', item:'Blue Bolt shrimp (10)', role:'Sold', amount:400 }
  ];
  var aucFilter = 'All', aucSortKey = 'date', aucSortAsc = false;

  function money2(n){ return 'R' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  function renderAuctionStats(){
    var spent = 0, sold = 0, boughtCount = 0, soldCount = 0;
    var auctionDates = {};
    AUCTIONS.forEach(function(a){
      auctionDates[a.date] = true;
      if (a.role === 'Bought'){ spent += a.amount; boughtCount++; }
      else { sold += a.amount; soldCount++; }
    });
    var net = sold - spent;
    var total = AUCTIONS.length;
    var avg = total ? Math.round((spent + sold) / total) : 0;
    document.getElementById('auction-total-spent').textContent = money2(spent);
    document.getElementById('auction-total-sold').textContent = money2(sold);
    var netEl = document.getElementById('auction-total-net');
    netEl.textContent = (net >= 0 ? '+' : '−') + money2(Math.abs(net));
    netEl.className = net >= 0 ? 'pos' : 'neg';
    document.getElementById('auction-net-title').textContent = 'Net ' + (net >= 0 ? '+' : '−') + money2(Math.abs(net)) + ' across ' + total + ' lot' + (total===1?'':'s');
    document.getElementById('auction-lots-bought').textContent = boughtCount;
    document.getElementById('auction-lots-sold').textContent = soldCount;
    document.getElementById('auction-count').textContent = Object.keys(auctionDates).length;
    document.getElementById('auction-avg').textContent = 'R' + avg;

    // Dashboard's compact copy of the same figures — no separate query, just
    // the same AUCTIONS array this function already reduces over.
    var dashNet = document.getElementById('dash-auction-net');
    var dashSub = document.getElementById('dash-auction-sub');
    if (dashNet && dashSub){
      dashNet.textContent = (net >= 0 ? '+' : '\u2212') + money2(Math.abs(net));
      dashNet.style.color = net >= 0 ? 'var(--leaf-dark)' : 'var(--coral-dark)';
      dashSub.textContent = total
        ? boughtCount + ' bought \u00B7 ' + soldCount + ' sold \u00B7 ' + total + ' lot' + (total === 1 ? '' : 's') + ' total'
        : 'No lots logged yet';
    }
  }

  function renderAuctionTable(){
    var rows = AUCTIONS.filter(function(a){ return aucFilter === 'All' || a.role === aucFilter; });
    rows = rows.slice().sort(function(x, y){
      var vx = x[aucSortKey], vy = y[aucSortKey];
      if (aucSortKey === 'amount'){ vx = x.amount; vy = y.amount; }
      else if (aucSortKey === 'date'){ vx = new Date(x.date); vy = new Date(y.date); }
      else { vx = String(vx).toLowerCase(); vy = String(vy).toLowerCase(); }
      if (vx < vy) return aucSortAsc ? -1 : 1;
      if (vx > vy) return aucSortAsc ? 1 : -1;
      return 0;
    });
    var body = document.getElementById('auction-tbody');
    body.innerHTML = rows.map(function(a){
      var roleBadge = a.role === 'Sold' ? '<span class="badge ok">Sold</span>' : '<span class="badge warn">Bought</span>';
      var amountDisplay = (a.role === 'Sold' ? '+' : '−') + money2(a.amount);
      return '<tr><td class="reg-member">' + escT(a.date) + '</td><td class="reg-species" style="font-style:normal">' + escT(a.item) + '</td>' +
        '<td>' + roleBadge + '</td>' +
        '<td style="font-weight:700;color:' + (a.role==='Sold' ? 'var(--leaf-dark)' : 'var(--coral-dark)') + '">' + amountDisplay + '</td></tr>';
    }).join('');
    document.getElementById('auction-empty').style.display = rows.length ? 'none' : 'block';
    document.getElementById('auction-count-line').textContent = 'Showing ' + rows.length + ' of ' + AUCTIONS.length + ' lots';
    document.querySelectorAll('#view-auctions .reg-table thead th[data-akey]').forEach(function(th){
      var on = th.getAttribute('data-akey') === aucSortKey;
      th.classList.toggle('sorted', on);
      var arr = th.querySelector('.arr');
      if (arr) arr.textContent = on ? (aucSortAsc ? '\u25B2' : '\u25BC') : '\u25B2';
    });
  }

  function renderAuctions(){ renderAuctionStats(); renderAuctionTable(); }
  renderAuctions();

  document.querySelectorAll('[data-aucf]').forEach(function(b){
    b.addEventListener('click', function(){
      document.querySelectorAll('[data-aucf]').forEach(function(x){ x.classList.remove('active'); });
      b.classList.add('active');
      aucFilter = b.getAttribute('data-aucf');
      renderAuctionTable();
    });
  });
  document.querySelectorAll('#view-auctions .reg-table thead th[data-akey]').forEach(function(th){
    th.addEventListener('click', function(){
      var k = th.getAttribute('data-akey');
      if (k === aucSortKey) aucSortAsc = !aucSortAsc; else { aucSortKey = k; aucSortAsc = true; }
      renderAuctionTable();
    });
  });

  // ===== Renewal / EFT payment =====
  var renewModal = document.getElementById('renew-modal');
  function openRenewModal(){ renewModal.classList.add('show'); }
  function closeRenewModal(){ renewModal.classList.remove('show'); }
  document.getElementById('renew-open-btn').addEventListener('click', openRenewModal);
  document.getElementById('fab-renew').addEventListener('click', openRenewModal);
  document.getElementById('renew-modal-close').addEventListener('click', closeRenewModal);
  renewModal.addEventListener('click', function(e){ if (e.target === renewModal) closeRenewModal(); });

  function copyText(text, btn){
    var done = function(){ popToast('Copied: ' + text); };
    if (navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(done).catch(done);
    } else { done(); }
  }
  // ===== Club config into the UI =====
  // Fees render from MEMBER_TYPES and banking from CLUB.bank, so these facts are
  // stated once in config rather than repeated across the markup.
  (function(){
    var feeRows = document.getElementById('fee-rows');
    if (feeRows){
      var areaNote = { 'Full': 'Local households — ' + CLUB.localAreas,
                       'Country': 'Households outside the local areas above',
                       'Scholar': 'Full member benefits at the reduced scholar rate',
                       'Family': 'Already covered by a household membership — nothing to pay' };
      feeRows.innerHTML = Object.keys(MEMBER_TYPES).map(function(k){
        var t = MEMBER_TYPES[k];
        return '<div class="row"><div class="row-body"><b>' + escT(feeShort(t.fee)) + ' · ' + escT(t.plural) +
          '</b><span>' + (areaNote[k] || '') + '</span></div></div>';
      }).join('');
    }
    var feeHeading = document.getElementById('fee-heading');
    if (feeHeading) feeHeading.textContent = feesDueYear() + ' fee structure';

    var mtSel = document.getElementById('mt-type');
    if (mtSel){
      mtSel.innerHTML = Object.keys(MEMBER_TYPES).map(function(k){
        return '<option value="' + k + '">' + escT(MEMBER_TYPES[k].label) + ' — ' + escT(feeShort(MEMBER_TYPES[k].fee)) + '</option>';
      }).join('');
    }

    var setTxt = function(id, v){ var el = document.getElementById(id); if (el) el.textContent = v; };
    setTxt('eft-bank', CLUB.bank.name);
    setTxt('eft-account-name', CLUB.bank.accountName);
    setTxt('eft-account-no', CLUB.bank.accountNumber);
    setTxt('eft-branch', CLUB.bank.branchCode);
    var copyNo = document.getElementById('eft-copy-no');
    if (copyNo) copyNo.addEventListener('click', function(){
      // Copy digits only — the displayed spacing is for reading, not for pasting
      // into a banking form. The old markup copied a differently-spaced string.
      copyText(CLUB.bank.accountNumber.replace(/\s+/g, ''), copyNo);
    });
  })();
  document.getElementById('renew-copy-ref').addEventListener('click', function(){
    copyText(document.getElementById('renew-ref').textContent, this);
  });
  document.getElementById('renew-mark-paid').addEventListener('click', function(){
    document.getElementById('renew-actions').style.display = 'none';
    document.getElementById('renew-confirmed').style.display = 'flex';
    document.querySelectorAll('#renew-open-btn, #fab-renew').forEach(function(b){
      b.textContent = b.id === 'fab-renew' ? 'Renewal submitted ✓' : 'Renewal submitted — awaiting confirmation';
    });
    popToast('Payment marked — the treasurer will confirm your renewal shortly');
  });

  // esc closes the new modals too
  document.addEventListener('keydown', function(e){
    if (e.key !== 'Escape') return;
    closeAwardModal(); closeRenewModal();
  });

  // FAB
  var fabWrap = document.getElementById('fab-wrap');
  document.getElementById('fab').addEventListener('click', function(){
    var open = fabWrap.classList.toggle('open');
    this.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  document.addEventListener('click', function(e){
    if (!fabWrap.contains(e.target)) fabWrap.classList.remove('open');
  });

  // The register is database-backed. This array is the in-memory shape the whole
  // view renders from: loadBreederListings() fills it from breeder_listings for a
  // signed-in member, and it stays empty in demo mode.
  //
  // It used to be seeded with 92 hardcoded rows naming 13 real members — the
  // pre-migration register, frozen in time. Live members never saw them (IS_LIVE
  // gave an empty array either way), but the names sat in this file in plain text
  // where anyone fetching app.js could read them. Removed: members and the
  // committee will populate the real register through the app.
  var BREG = [];

  // ===== Members directory (derived from register + club roles) =====
  // One green for every member's initials, in the directory and in the drawer it
  // opens. The old rotating palette assigned colours by position in the filtered
  // list, so the same person changed colour as soon as a filter or a search
  // narrowed the results — a colour that means nothing and won't sit still is
  // worse than no colour at all.
  var MEMBER_AVATAR_BG = 'linear-gradient(180deg,var(--leaf),var(--leaf-dark))';
  function initials(n){ return n.split(/\s+/).map(function(w){return w[0];}).slice(0,2).join('').toUpperCase(); }

  var byMember = {};
  BREG.forEach(function(d){
    (byMember[d.member] = byMember[d.member] || []).push(d);
  });
  var DIR = Object.keys(byMember).map(function(name){
    var rows = byMember[name];
    var cats = {}; rows.forEach(function(r){ cats[r.category] = (cats[r.category]||0)+1; });
    var current = rows.filter(function(r){ return r.status === 'Current'; }).length;
    var hasShrimp = rows.some(function(r){ return /shrimp|caridina/i.test(r.species); });
    return { name:name, role:'Member', breeder:true, cats:Object.keys(cats), listings:rows.length, current:current, shrimp:hasShrimp,
      blurb:'On the breeders register with ' + rows.length + ' listing' + (rows.length>1?'s':'') + ' (' + Object.keys(cats).join(', ').toLowerCase() + ').' };
  });
  var COMMITTEE = [
    { name:'Judy Nel', role:'President', email:'president@ecaac.co.za', blurb:'Founding-year member, Club Member of the Year 2025. Planted tanks, Tanganyikans and Caridina shrimp.' },
    { name:'Patrick Emmett', role:'Vice President', email:'vp@ecaac.co.za', blurb:'Volunteer committee — vice president.' },
    { name:'Claudette Bailey', role:'Secretary', email:'secretary@ecaac.co.za', blurb:'Volunteer committee — secretary and meeting minutes.' },
    { name:'Carlo de Villiers', role:'Treasurer', email:'treasurer@ecaac.co.za', blurb:'Volunteer committee — treasurer, membership fees and invoices.' },
    { name:'James McLean', role:'Digital', email:'digital@ecaac.co.za', blurb:'Volunteer committee — website, portal and digital.' }
  ];
  COMMITTEE.slice().reverse().forEach(function(c){
    DIR.unshift({ name:c.name, role:c.role, committee:true, breeder:false, cats:['Committee'], listings:0, current:0, shrimp:c.name==='Judy Nel',
      email:c.email, blurb:c.blurb });
  });

  var dirGrid = document.getElementById('dir-grid');
  var dirEmpty = document.getElementById('dir-empty');
  var dirSearch = document.getElementById('dir-search');
  var dirFilter = 'all';
  var dirVisible = [];

  // Matches a member against a directory filter. Legacy demo rules (committee /
  // breeder / plants / shrimp) are preserved; live members also match on their
  // stored interests, and the new interest pills match purely on those.
  function memberMatchesDirFilter(m, f){
    if (f === 'committee') return !!m.committee;
    if (f === 'breeder') return !!m.breeder;
    var interests = (m.interests || []).map(function(s){ return String(s).toLowerCase(); });
    if (f === 'plants') return interests.indexOf('plants') !== -1 || m.cats.indexOf('Plant') !== -1;
    if (f === 'shrimp') return interests.indexOf('shrimp') !== -1 || !!m.shrimp;
    return interests.indexOf(f) !== -1;
  }

  function renderDir(){
    var q = (dirSearch.value || '').toLowerCase();
    var out = DIR.filter(function(m){
      if (dirFilter !== 'all' && !memberMatchesDirFilter(m, dirFilter)) return false;
      if (q && (m.name + ' ' + m.blurb + ' ' + m.cats.join(' ') + ' ' + (m.interests || []).join(' ')).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    dirVisible = out;
    dirGrid.innerHTML = out.map(function(m, i){
      var tags = m.committee
        ? '<span class="n">Committee</span>'
        : (m.typePill
            ? '<span>' + escT(m.typePill) + '</span>'
            : m.cats.map(function(c){ return '<span>' + c + '</span>'; }).join(''));
      if (m.founding) tags += '<span class="founding">Founding member</span>';
      // Interests deliberately not shown here — the pill row got long enough to
      // push the card taller than its neighbours. The drawer's own "Interests"
      // section still lists them, and the filter pills read m.interests directly.
      var meta = m.breeder
        ? '<div class="dir-meta"><span><b>' + m.listings + '</b> register listings</span><span><b>' + m.current + '</b> breeding now</span></div>'
        : '<div class="dir-meta"><span>' + (m.email ? '<a href="mailto:' + escA(m.email) + '" style="color:var(--leaf-dark);font-weight:700">' + escT(m.email) + '</a>' : '<b>' + escT(m.metaLine || '') + '</b>') + '</span></div>';
      return '<div class="dir-card" data-dir-idx="' + i + '" role="button" tabindex="0" aria-label="View ' + escA(m.name) + '\u2019s profile">' +
        '<div class="dir-avatar" style="background:' + MEMBER_AVATAR_BG + '">' + initials(m.name) + '</div>' +
        // name/role/bio are member-editable, so they get escaped here just as the
        // drawer already does (textContent for name/role, escT for the bio).
        '<div class="dir-body"><h4>' + escT(m.name) + '</h4><div class="dir-role">' + escT(m.role || '') + '</div>' +
        // Bio removed from the card: it was the tallest, most variable element
        // here and pushed cards to different heights depending on how much
        // someone had written. It still appears in full in the drawer, which is
        // what the "View profile" affordance below now points at.
        '<div class="dir-tags">' + tags + '</div>' + meta +
        '<div class="dir-open">View profile<span class="dir-open-arrow" aria-hidden="true">\u2192</span></div>' +
        '</div></div>';
    }).join('');
    dirEmpty.style.display = out.length ? 'none' : 'block';
    dirGrid.style.display = out.length ? 'grid' : 'none';
    document.getElementById('dir-count').textContent = out.length + ' active member' + (out.length===1?'':'s');
  }
  dirSearch.addEventListener('input', renderDir);
  // Delegated so it survives every re-render of the grid.
  dirGrid.addEventListener('click', function(e){
    var card = e.target.closest('.dir-card');
    if (!card) return;
    if (e.target.closest('a')) return;           // let the committee mailto links work
    openMemberDrawer(dirVisible[parseInt(card.getAttribute('data-dir-idx'), 10)]);
  });
  dirGrid.addEventListener('keydown', function(e){
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var card = e.target.closest('.dir-card');
    if (!card) return;
    e.preventDefault();
    openMemberDrawer(dirVisible[parseInt(card.getAttribute('data-dir-idx'), 10)]);
  });
  document.querySelectorAll('[data-dirf]').forEach(function(b){
    b.addEventListener('click', function(){
      document.querySelectorAll('[data-dirf]').forEach(function(x){ x.classList.remove('active'); });
      b.classList.add('active');
      dirFilter = b.getAttribute('data-dirf');
      renderDir();
    });
  });
  renderDir();

  // Which aquariums belong to this directory entry. Reuses data already loaded:
  // the signed-in member's own tanks, or otherMemberTanks for everyone else.
  function tanksForMember(m){
    if (!m) return [];
    if (window.currentMember && m.memberId === window.currentMember.id){
      return tanks.map(function(t, i){ return Object.assign({}, t, { owner: member.name, mine:true, myIndex:i }); });
    }
    if (m.memberId) return (otherMemberTanks || []).filter(function(t){ return t.ownerId === m.memberId; });
    // Demo entries have no id — fall back to matching the owner name.
    return (otherMemberTanks || []).filter(function(t){ return (t.owner || '') === m.name; });
  }

  function mdTanksHtml(list){
    if (!list.length) return '';
    return '<div class="md-sec"><h4>Their aquariums \u00B7 ' + list.length + '</h4><div class="md-tanks">' +
      list.map(function(t, i){
        var st = TYPE_STYLE[t.type] || TYPE_STYLE['Freshwater'];
        var cover = coverUrl(t);
        var thumb = cover
          ? '<img src="' + escA(cover) + '" alt="" loading="lazy">'
          : '<span class="md-tank-icon">' + ICONS[st[2]] + '</span>';
        var liveCount = (t.livestock || []).reduce(function(a, l){ var n = parseInt(l[2],10); return a + (isNaN(n) ? (l[2] ? 1 : 0) : n); }, 0);
        var plantCount = (t.plants || []).length;
        return '<button class="md-tank" data-md-tank="' + i + '">' +
          '<span class="md-tank-thumb" style="background:linear-gradient(135deg,' + st[0] + ',' + st[1] + ')">' + thumb + '</span>' +
          '<span class="md-tank-txt"><b>' + escT(t.name) + '</b>' +
          '<span>' + (t.volume ? t.volume + ' \u2113 \u00B7 ' : '') + escT(t.type) + '</span>' +
          '<span>' + liveCount + ' livestock \u00B7 ' + plantCount + ' plant' + (plantCount === 1 ? '' : 's') + '</span></span></button>';
      }).join('') + '</div></div>';
  }

  // ===== Member detail drawer =====
  // Opens from a directory card. Shows bio, interests, shared interests, awards
  // standing and earned badges. Deliberately shows no email or phone number.
  var memDrawer = document.getElementById('mem-drawer');
  var memScrim = document.getElementById('md-scrim');
  var mdBody = document.getElementById('md-body');
  var mdLastFocus = null;
  var mdToken = 0;                              // guards against a slow fetch landing after the drawer moved on
  var mdTanks = [];                             // the open member's tanks, for the gallery below

  // Hands off to the existing aquarium preview modal rather than rebuilding it.
  // Delegated because the drawer body is re-rendered when the stats arrive.
  if (mdBody) mdBody.addEventListener('click', function(e){
    var btn = e.target.closest('[data-md-tank]');
    if (!btn) return;
    var t = mdTanks[parseInt(btn.getAttribute('data-md-tank'), 10)];
    if (t) openMaPreview(t);
  });

  function closeMemberDrawer(){
    if (!memDrawer) return;
    memDrawer.classList.remove('open');
    memDrawer.setAttribute('aria-hidden', 'true');
    if (memScrim) memScrim.classList.remove('show');
    if (mdLastFocus && mdLastFocus.focus) mdLastFocus.focus();
    mdLastFocus = null;
  }
  var mdCloseBtn = document.getElementById('md-close');
  if (mdCloseBtn) mdCloseBtn.addEventListener('click', closeMemberDrawer);
  if (memScrim) memScrim.addEventListener('click', closeMemberDrawer);
  document.addEventListener('keydown', function(e){
    if (e.key !== 'Escape') return;
    // The aquarium preview opens on top of the drawer, so let it take Escape first.
    var previewOpen = maModal && maModal.classList.contains('show');
    if (previewOpen) return;
    if (memDrawer && memDrawer.classList.contains('open')) closeMemberDrawer();
  });

  // Which interests the viewer and this member have in common.
  function sharedInterestsWith(m){
    var mine = String((window.currentMember && window.currentMember.interests) || '')
      .split(',').map(function(s){ return s.trim().toLowerCase(); }).filter(Boolean);
    if (!mine.length) return [];
    return (m.interests || []).filter(function(x){ return mine.indexOf(String(x).toLowerCase()) !== -1; });
  }
  function listPhrase(arr){
    if (arr.length === 1) return arr[0];
    if (arr.length === 2) return arr[0] + ' and ' + arr[1];
    return arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1];
  }

  // Pulls the numbers behind another member's standing. Each query is tolerated
  // independently: if the database declines one (row-level security), that stat
  // reports as unknown rather than a misleading zero.
  async function loadMemberStanding(memberId){
    var res = { awardPoints:0, programPoints:{ BAP:0, HAP:0, AAP:0, SBP:0 }, entryCount:0,
                meetings:0, auctionValue:0, tankCount:0, failed:[] };
    if (!sb || !memberId) return res;
    var out = await Promise.all([
      sb.from('award_entries').select('program,points,status').eq('member_id', memberId).eq('status', 'approved'),
      sb.from('event_attendance').select('id').eq('member_id', memberId),
      sb.from('auction_lots').select('amount').eq('member_id', memberId)
    ].map(function(p){ return Promise.resolve(p).then(function(r){ return r; }, function(err){ return { error: err }; }); }));
    if (out[0] && !out[0].error){
      (out[0].data || []).forEach(function(r){
        res.entryCount++;
        res.awardPoints += (r.points || 0);
        if (res.programPoints[r.program] !== undefined) res.programPoints[r.program] += (r.points || 0);
      });
    } else res.failed.push('awards');
    if (out[1] && !out[1].error) res.meetings = (out[1].data || []).length; else res.failed.push('meetings');
    if (out[2] && !out[2].error) res.auctionValue = (out[2].data || []).reduce(function(s, r){ return s + Number(r.amount || 0); }, 0);
    else res.failed.push('auctions');
    // Tank count comes from data already in memory — no extra round trip.
    if (window.currentMember && memberId === window.currentMember.id) res.tankCount = tanks.length;
    else res.tankCount = (otherMemberTanks || []).filter(function(t){ return t.ownerId === memberId || t.owner_id === memberId; }).length;
    return res;
  }

  function mdStandingHtml(stats, joinDate){
    var tenure = joinDate ? Math.max(0, new Date().getFullYear() - new Date(joinDate).getFullYear()) : 0;
    var cats = badgeCatsFrom({
      meetings: stats.meetings, auctionValue: stats.auctionValue, awardPoints: stats.awardPoints,
      tankCount: stats.tankCount, tenureYears: tenure
    });
    var highest = -1, earned = 0, badges = [];
    cats.forEach(function(cat){
      var prog = tierProgress(cat);
      earned += prog.achieved;
      if (prog.achieved - 1 > highest) highest = prog.achieved - 1;
      if (prog.achieved > 0){
        var idx = prog.achieved - 1;
        badges.push('<span class="md-badge ' + TIER_CLASS[idx] + '">' + escT(TIER_NAMES[idx] + ' \u00B7 ' + cat.label) + '</span>');
      }
    });
    var html = '<div class="md-sec"><h4>Current standing</h4>' +
      '<div class="md-standing"><div><div class="md-standing-tier">' + (highest >= 0 ? TIER_NAMES[highest] : 'Unranked') + '</div>' +
      '<div class="md-standing-sub">' + earned + ' badge' + (earned === 1 ? '' : 's') + ' earned across ' + cats.length + ' categories</div></div></div></div>';

    html += '<div class="md-sec"><h4>Award programs</h4><div class="md-stats">' +
      ['BAP','HAP','AAP','SBP'].map(function(k){
        return '<div class="md-stat"><b>' + (stats.programPoints[k] || 0) + '</b><span>' + k + ' points</span></div>';
      }).join('') + '</div>' +
      '<p class="md-note"><b>' + stats.awardPoints + '</b> points from <b>' + stats.entryCount + '</b> approved entr' + (stats.entryCount === 1 ? 'y' : 'ies') + '.</p></div>';

    html += '<div class="md-sec"><h4>Badges earned</h4>' +
      (badges.length ? '<div class="md-badges">' + badges.join('') + '</div>'
                     : '<p class="md-empty">No badges yet \u2014 early days.</p>') + '</div>';

    if (stats.failed.length){
      html += '<p class="md-note">Some figures couldn\u2019t be read for this member (' + escT(stats.failed.join(', ')) +
        '), so their standing may be understated.</p>';
    }
    return html;
  }

  async function openMemberDrawer(m){
    if (!m || !memDrawer) return;
    mdLastFocus = document.activeElement;
    var token = ++mdToken;
    document.getElementById('md-name').textContent = m.name;
    document.getElementById('md-role').textContent = m.role || '';
    var av = document.getElementById('md-avatar');
    av.textContent = initials(m.name);
    av.style.background = MEMBER_AVATAR_BG;

    // Static parts render immediately; the numbers stream in after.
    var head = '';
    var shared = sharedInterestsWith(m);
    if (shared.length){
      head += '<div class="md-sec"><div class="md-shared">You both keep <span>' + escT(listPhrase(shared)) + '</span>.</div></div>';
    }
    if ((m.interests || []).length){
      head += '<div class="md-sec"><h4>Interests</h4><div class="md-pills">' +
        m.interests.map(function(x){ return '<span>' + escT(x) + '</span>'; }).join('') + '</div></div>';
    }
    head += '<div class="md-sec"><h4>About</h4><p class="md-bio">' + escT(m.blurb || '') + '</p></div>';
    mdTanks = tanksForMember(m);
    head += mdTanksHtml(mdTanks);
    if (m.joinDate){
      head += '<div class="md-sec"><h4>Member since</h4><p class="md-bio">' +
        new Date(m.joinDate).toLocaleDateString('en-ZA', { month:'long', year:'numeric' }) +
        (m.founding ? ' <span class="founding">Founding member</span>' : '') + '</p></div>';
    }

    mdBody.innerHTML = head + (m.memberId
      ? '<div class="md-sec"><h4>Current standing</h4><p class="md-empty">Loading standing\u2026</p></div>'
      : '');

    memDrawer.classList.add('open');
    memDrawer.setAttribute('aria-hidden', 'false');
    if (memScrim) memScrim.classList.add('show');
    if (mdCloseBtn) mdCloseBtn.focus();

    if (!m.memberId) return;
    var stats = await loadMemberStanding(m.memberId);
    if (token !== mdToken) return;              // closed, or another member opened meanwhile
    mdBody.innerHTML = head + mdStandingHtml(stats, m.joinDate);
  }

  // ===== Breeders register =====
  var regBody = document.getElementById('reg-tbody');
  var regEmpty = document.getElementById('reg-empty');
  var regCount = document.getElementById('reg-count');
  var regSearch = document.getElementById('reg-search');
  var regCat = 'All', regStat = 'All', regSortKey = 'member', regSortAsc = true;
  var regLoading = IS_LIVE;                     // true until the first live fetch resolves
  var regError = false;                         // sticky: a failed fetch must not read as an empty register
  var REG_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function fmtRegDate(iso){
    var d = new Date(String(iso).slice(0, 10) + 'T00:00:00');
    if (isNaN(d.getTime())) return String(iso).slice(0, 10);
    return d.getDate() + ' ' + REG_MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }

  // Register stats. Computed from BREG so it works identically for demo data and
  // for live rows loaded from breeder_listings.
  function renderRegStats(){
    var el = document.getElementById('reg-stats');
    if (!el) return;
    // Keyed on member id where there is one. Counting by display name merged two
    // members who happen to share one, and collapsed every row whose owner name
    // failed to load — they all fall back to the same "ECAAC member" string — into
    // a single breeder.
    var seen = {};
    BREG.forEach(function(d){
      var key = d.memberId ? 'id:' + d.memberId : (d.member ? 'nm:' + d.member : null);
      if (key) seen[key] = true;
    });
    var breeders = Object.keys(seen).length;
    var species = BREG.length;
    var current = BREG.filter(function(d){ return d.status === 'Current'; }).length;
    var ship = BREG.filter(function(d){ return d.shipping === 'Yes'; }).length;
    el.innerHTML =
      '<div class="card t-leaf"><div class="stat-num">' + breeders + '</div><div class="stat-label">Active breeders listed</div></div>' +
      '<div class="card t-deep"><div class="stat-num">' + species + '</div><div class="stat-label">Species &amp; items on the register</div></div>' +
      '<div class="card t-gold"><div class="stat-num">' + current + '</div><div class="stat-label">Breeding or growing right now</div></div>' +
      '<div class="card t-coral"><div class="stat-num">' + ship + '</div><div class="stat-label">Listings that can ship</div></div>';
  }
  renderRegStats();

  function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function renderReg(){
    var q = (regSearch.value || '').toLowerCase();
    var rows = BREG.filter(function(d){
      if (regCat !== 'All' && d.category !== regCat) return false;
      if (regStat !== 'All' && d.status !== regStat) return false;
      if (q && (d.member + ' ' + d.species).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    rows.sort(function(a,b){
      var va = (a[regSortKey]||'').toLowerCase(), vb = (b[regSortKey]||'').toLowerCase();
      if (va < vb) return regSortAsc ? -1 : 1;
      if (va > vb) return regSortAsc ? 1 : -1;
      return a.species.localeCompare(b.species);
    });
    regBody.innerHTML = rows.map(function(d){
      var statusHtml = d.status === 'Current'
        ? '<span class="reg-dot cur"></span><span class="badge ok">Breeding now</span>'
        : '<span class="reg-dot fut"></span><span class="badge pend">Planned</span>';
      // Both values are pills so the column reads as one thing. Plain text next
      // to a badge looked like a missing value rather than the other option.
      var shipHtml = d.shipping === 'Yes'
        ? '<span class="badge info">Ships</span>'
        : '<span class="badge mute">Collection</span>';
      return '<tr><td class="reg-member" data-label="Breeder">' + esc(d.member) + '</td>' +
        '<td class="reg-species" data-label="Species / item">' + esc(d.species) + '</td>' +
        '<td class="reg-cat" data-label="Category">' + esc(d.category) + '</td>' +
        '<td class="reg-status" data-label="Status">' + statusHtml + '</td>' +
        '<td class="reg-pref" data-label="Sale">' + esc(d.pref) + '</td>' +
        '<td class="reg-ship" data-label="Ship">' + shipHtml + '</td></tr>';
    }).join('');
    // Distinguish "still loading", "register is empty" and "filters match nothing".
    if (regLoading) regEmpty.textContent = 'Loading the register\u2026';
    // Without this the message reverted the moment anyone touched the search box
    // or a filter chip: renderReg saw an empty BREG and reported the register as
    // empty, which is a different and much more discouraging claim than a failed
    // fetch.
    else if (regError) regEmpty.textContent = 'Could not load the register just now \u2014 try refreshing.';
    else if (!BREG.length) regEmpty.textContent = IS_LIVE
      ? 'Nothing on the register yet \u2014 add what you\u2019re breeding using the panel below.'
      : 'Nothing on the register yet.';
    else regEmpty.textContent = 'Nothing matches those filters \u2014 try clearing the search or picking another category.';
    regEmpty.style.display = rows.length ? 'none' : 'block';
    regCount.textContent = regLoading ? '' : 'Showing ' + rows.length + ' of ' + BREG.length + ' listings';
    // "Last updated" derived from the newest listing rather than a fixed date.
    var updEl = document.getElementById('reg-updated');
    if (updEl){
      var newest = BREG.reduce(function(acc, d){
        return (d.updated && (!acc || d.updated > acc)) ? d.updated : acc;
      }, null);
      updEl.textContent = (newest ? 'Register last updated ' + fmtRegDate(newest) + ' \u00B7 ' : '') +
        'Contact a breeder through the committee to arrange a swap or collection.';
    }
    // Scoped to #view-breeders and to headers that actually carry data-key. The
    // auction history table reuses .reg-table with data-akey, so the unscoped
    // selector matched its four headers as well: getAttribute('data-key') returns
    // null there, and once a stray click had set regSortKey to null, null === null
    // lit up all four auction headers as "sorted" at once.
    document.querySelectorAll('#view-breeders .reg-table thead th[data-key]').forEach(function(th){
      var on = th.getAttribute('data-key') === regSortKey;
      th.classList.toggle('sorted', on);
      var arr = th.querySelector('.arr');
      if (arr) arr.textContent = on ? (regSortAsc ? '\u25B2' : '\u25BC') : '\u25B2';
    });
  }
  regSearch.addEventListener('input', renderReg);
  document.querySelectorAll('[data-regcat]').forEach(function(b){
    b.addEventListener('click', function(){
      document.querySelectorAll('[data-regcat]').forEach(function(x){ x.classList.remove('active'); });
      b.classList.add('active'); regCat = b.getAttribute('data-regcat'); renderReg();
    });
  });
  document.querySelectorAll('[data-regstat]').forEach(function(b){
    b.addEventListener('click', function(){
      document.querySelectorAll('[data-regstat]').forEach(function(x){ x.classList.remove('active'); });
      b.classList.add('active'); regStat = b.getAttribute('data-regstat'); renderReg();
    });
  });
  // Same scoping, and the more consequential half: this handler was bound to the
  // auction table's headers too, so clicking "Amount" or "Role" over on Auctions
  // set the register's sort key to null and silently reshuffled the breeders
  // table on a page the member wasn't even looking at.
  document.querySelectorAll('#view-breeders .reg-table thead th[data-key]').forEach(function(th){
    th.addEventListener('click', function(){
      var k = th.getAttribute('data-key');
      if (!k) return;
      if (k === regSortKey) regSortAsc = !regSortAsc; else { regSortKey = k; regSortAsc = true; }
      renderReg();
    });
  });
  renderReg();
  renderMyListings();

  // ===== Breeders register: live data + member self-service =====
  // BREG is the single array the table renders from. In demo mode it holds the
  // sample data; in live mode it is filled from breeder_listings below, so all the
  // existing filter, sort and render code above works unchanged.
  function blRowToReg(r){
    var nm = r.members
      ? ((r.members.first_name || '') + ' ' + (r.members.last_name || '')).trim()
      : '';
    return {
      id: r.id,
      member: nm || 'ECAAC member',
      memberId: r.member_id,
      category: r.category || 'Fish',
      species: r.species || '',
      status: r.status === 'Future' ? 'Future' : 'Current',
      shipping: r.shipping ? 'Yes' : 'No',
      pref: r.pref || 'Unknown',
      updated: (r.updated_at || r.created_at || '').slice(0, 10)
    };
  }

  async function loadBreederListings(){
    if (!sb || !window.currentMember){ regLoading = false; renderReg(); renderMyListings(); return; }
    var res = await sb.from('breeder_listings')
      .select('*, members!member_id(first_name,last_name)')
      .order('species', { ascending: true });
    regLoading = false;
    if (res.error){
      // Don't leave a failed fetch looking like "nobody is breeding anything".
      regError = true;
      renderRegStats();
      renderReg();
      regEmpty.style.display = 'block';
      return;
    }
    regError = false;
    BREG.length = 0;
    (res.data || []).forEach(function(r){ BREG.push(blRowToReg(r)); });
    renderRegStats();
    renderReg();
    renderMyListings();
  }

  function renderMyListings(){
    // Dashboard summary: works in both modes, since BREG always holds either
    // the demo fixtures or the real loaded rows. "My listings" (below) only
    // ever applies to a live signed-in member.
    var dashEl = document.getElementById('dash-breeder-summary');
    if (dashEl){
      var mineCount = (sb && window.currentMember)
        ? BREG.filter(function(d){ return d.memberId === window.currentMember.id; }).length
        : 0;
      var totalLine = BREG.length
        ? '<b>' + BREG.length + '</b> listing' + (BREG.length === 1 ? '' : 's') + ' on the register right now'
        : 'Nothing on the register yet';
      var mineLine = (sb && window.currentMember)
        ? '<p style="font-size:12.5px;color:var(--ink-soft);margin:6px 0 0">' + (mineCount
            ? 'You have <b>' + mineCount + '</b> of them.'
            : 'You haven\u2019t listed anything yet \u2014 add what you\u2019re breeding from the register page.') + '</p>'
        : '';
      dashEl.innerHTML = '<p style="font-size:13.5px;color:var(--ink);margin:0">' + totalLine + '</p>' + mineLine;
    }

    var wrap = document.getElementById('my-listings-wrap');
    var list = document.getElementById('my-listings');
    if (!wrap || !list) return;
    if (!sb || !window.currentMember){ wrap.style.display = 'none'; return; }
    wrap.style.display = '';
    var mine = BREG.filter(function(d){ return d.memberId === window.currentMember.id; });
    if (!mine.length){
      list.innerHTML = '<div class="reg-empty" style="padding:20px">You haven\u2019t listed anything yet.</div>';
      return;
    }
    list.innerHTML = mine.map(function(d){
      var badge = d.status === 'Current'
        ? '<span class="badge ok">Breeding now</span>'
        : '<span class="badge pend">Planned</span>';
      return '<div class="row"><div class="row-body"><b>' + esc(d.species) + '</b>' +
        '<span>' + esc(d.category) + ' \u00B7 ' + (d.shipping === 'Yes' ? 'can ship' : 'collection only') +
        ' \u00B7 ' + esc(d.pref) + '</span></div>' + badge +
        '<button class="rm-btn" data-bl-id="' + escA(d.id) + '" aria-label="Remove ' + escA(d.species) + '">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>';
    }).join('');
    list.querySelectorAll('[data-bl-id]').forEach(function(b){
      b.addEventListener('click', async function(){
        b.disabled = true;
        var res = await dbDeleteRow('breeder_listings', b.getAttribute('data-bl-id'));
        if (res && res.error){ b.disabled = false; popToast('Could not remove that listing'); return; }
        popToast('Listing removed');
        loadBreederListings();
      });
    });
  }

  // FAB shortcut: jump to the register and put the cursor in the species field.
  var fabListing = document.getElementById('fab-listing');
  if (fabListing) fabListing.addEventListener('click', function(){
    var fw = document.getElementById('fab-wrap');
    if (fw) fw.classList.remove('open');
    show('breeders');
    var wrap = document.getElementById('my-listings-wrap');
    var input = document.getElementById('bl-species');
    if (!sb || !window.currentMember || !wrap || wrap.style.display === 'none'){
      popToast('Sign in to add a listing to the register');
      return;
    }
    if (wrap.scrollIntoView) wrap.scrollIntoView({ behavior:'smooth', block:'center' });
    if (input) setTimeout(function(){ softFocus(input); }, 320);
  });

  var addingListing = false;
  var blAddBtn = document.getElementById('bl-add-btn');
  if (blAddBtn) blAddBtn.addEventListener('click', async function(){
    if (addingListing) return;
    if (!sb || !window.currentMember){ popToast('Sign in to add a listing'); return; }
    var species = document.getElementById('bl-species').value.trim();
    var errEl = document.getElementById('bl-error');
    if (!species){ errEl.style.display = 'block'; return; }
    errEl.style.display = 'none';
    addingListing = true;
    blAddBtn.disabled = true; blAddBtn.textContent = 'Adding\u2026';
    var res = await dbInsertRow('breeder_listings', {
      member_id: window.currentMember.id,
      species: species,
      category: document.getElementById('bl-category').value,
      status: document.getElementById('bl-status').value,
      pref: document.getElementById('bl-pref').value,
      shipping: document.getElementById('bl-shipping').value === 'Yes'
    });
    blAddBtn.disabled = false; blAddBtn.textContent = 'Add listing';
    if (res.error){ popToast('Could not add that listing \u2014 try again'); addingListing = false; return; }
    document.getElementById('bl-species').value = '';
    popToast(species + ' added to the register');
    loadBreederListings();
    addingListing = false;
  });

  // ===== My Aquariums: working data + CRUD =====
  // Note: demo state lives in memory; the production build persists to the member account.
  var TYPE_STYLE = {
    'Freshwater':   ['#082A3E','#041826','fish'],
    'Shrimp':       ['#3A1226','#1A0713','shrimp'],
    'Aquascape':    ['#0A1D0F','#0F2B15','plant'],
    'Marine':       ['#0B2C52','#051228','fish'],
    'Brackish':     ['#2B2A12','#121106','fish'],
    'Blackwater':   ['#2A1052','#0D0620','fish'],
    'Paludarium':   ['#16311B','#071409','plant'],
    'Vivarium':     ['#16311B','#071409','plant'],
    'Terrarium':    ['#171B3D','#06070F','terra']
  };
  var ICONS = {
    fish: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 12s4-6 12-6 8 6 8 6-2 6-8 6-12-6-12-6Z"/><circle cx="17" cy="10.5" r=".6" fill="currentColor" stroke="none"/></svg>',
    plant: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 21V9"/><path d="M12 12c0-4 3-7 7-7 0 4-3 7-7 7Z"/><path d="M12 15c0-4-3-6-7-6 0 4 3 6 7 6Z"/></svg>',
    shrimp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M19 7c-4.5 0-8 1.6-9.8 4.3C7.6 13.5 5.4 15 3 15c0 2.8 2.4 5 5.4 5 4.6 0 8.3-3.1 9.6-7.3"/><path d="M19 7c-2 0-3.6 1.3-3.6 3M8.4 20c-.6-1.2-.6-2.6 0-3.9M12 15.5c-.8-.8-1.2-1.9-1.1-3"/><circle cx="20.4" cy="6.2" r=".7" fill="currentColor" stroke="none"/></svg>',
    terra: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 2v20M4 8c4 2 12 2 16 0M4 16c4-2 12-2 16 0"/></svg>'
  };
  var fishRowIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s4-6 12-6 8 6 8 6-2 6-8 6-12-6-12-6Z"/><circle cx="17" cy="10.5" r=".6" fill="currentColor" stroke="none"/></svg>';
  var plantRowIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21V9"/><path d="M12 12c0-4 3-7 7-7 0 4-3 7-7 7Z"/><path d="M12 15c0-4-3-6-7-6 0 4 3 6 7 6Z"/></svg>';
  var checkRowIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>';
  var trophyRowIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4Z"/></svg>';

  var tanks = IS_LIVE ? [] : [
    { name:'Rift Lake Reef', type:'Freshwater', subtitle:'Tanganyika', volume:450, dims:'150 × 50 × 60', started:'Mar 2021',
      notes:'Aragonite sand, three ocean-rock towers, FX6 filtration.',
      tags:['Tanganyika','Aragonite sand','Rockwork','FX6 filtration'],
      params:[['8.6','pH'],['14°','KH'],['26 °C','Temp'],['0','Nitrite'],['10','Nitrate']],
      livestock:[['Neolamprologus multifasciatus','Shell-dweller colony · BAP approved','12'],['Julidochromis ornatus','Breeding pair · BAP pending','2']],
      plants:[['Ocean rock stacks','Hardscape · three reef towers','']],
      log:[['30% water change, vacuumed shell bed','Parameters logged after','18 Jul'],['Rockwork re-siliconed on left tower','Fish moved to holding for the day','29 Jun']],
      awards:[['BAP — N. multifasciatus (spawn)','+15 points · approved','ok'],['BAP — Julidochromis ornatus (spawn)','Fry at 30-day mark 10 Aug','pend']] },
    { name:'Emerald Valley', type:'Aquascape', subtitle:'Nature style', volume:180, dims:'90 × 45 × 45', started:'Jun 2023',
      notes:'CO₂ injected, aquasoil, RGB lighting. AAP 2nd place, Spring 2026.',
      tags:['Nature style','CO₂ injected','Aquasoil','RGB lighting','AAP 2nd place 2026'],
      params:[['6.6','pH'],['4°','KH'],['24 °C','Temp'],['30 mg/ℓ','CO₂'],['15','Nitrate']],
      livestock:[['Ember tetras','Shoal','18'],['Otocinclus','Algae crew','4']],
      plants:[['Bucephalandra \u2018Kedagang\u2019','On spider wood · HAP pending','6'],['Monte Carlo carpet','Foreground',''],['Rotala rotundifolia','Background stems','']],
      log:[['30% water change & filter rinse','Parameters logged after','20 Jul'],['Trimmed carpet & stems, dosed ferts','Replanted trimmings for HAP','13 Jul'],['CO₂ cylinder swapped','Working pressure checked','02 Jul']],
      awards:[['HAP — Bucephalandra \u2018Kedagang\u2019','Submitted 19 Jul 2026','pend'],['AAP — Spring showcase 2026','Scored 87/100 · 2nd place','ok']] },
    { name:'Caridina Corner', type:'Freshwater', subtitle:'Shrimp breeder', volume:54, dims:'60 × 30 × 30', started:'Jan 2024',
      notes:'RO water remineralised for Blue Bolts, active soil, sponge filtration.',
      tags:['Blue Bolt shrimp','RO + remineralised','Active soil','Sponge filtration'],
      params:[['6.0','pH'],['0°','KH'],['22 °C','Temp'],['110','TDS'],['5','Nitrate']],
      livestock:[['Caridina \u2018Blue Bolt\u2019','Breeding colony','60+'],['Springtails / snails','Clean-up crew','']],
      plants:[['Christmas moss','Breeding cover',''],['S\u00fcsswassertang','Floating cover','']],
      log:[['Topped up with RO, TDS rechecked','110 ppm after top-up','21 Jul'],['Fed bacter AE, culled two low-grades','Colony grading afternoon','12 Jul']],
      awards:[] },
    { name:'Rio Negro Shadows', type:'Blackwater', subtitle:'Rio Negro', volume:240, dims:'120 × 40 × 50', started:'Oct 2022',
      notes:'Botanicals and leaf litter, tannin-stained water, dim lighting.',
      tags:['Blackwater','Botanicals & leaf litter','Tannin-stained','Dim lighting'],
      params:[['5.4','pH'],['1°','KH'],['27 °C','Temp'],['0','Ammonia'],['5','Nitrate']],
      livestock:[['Cardinal tetras','Large shoal','25'],['Apistogramma agassizii','Pair — courting','2'],['Corydoras sterbai','Bottom crew','4']],
      plants:[['Mopani & driftwood tangle','Hardscape',''],['Amazon frogbit','Surface cover','']],
      log:[['Replaced catappa leaves, small top-up','Tannins refreshed','16 Jul'],['Apisto pair moved cave — possible spawn','Watching for eggs','08 Jul']],
      awards:[] },
    { name:'Waterfall Ridge', type:'Paludarium', subtitle:'Waterfall build', volume:150, dims:'80 × 40 × 80', started:'Feb 2025',
      notes:'Waterfall pump, misting system, epiphytes above the waterline.',
      tags:['Paludarium','Waterfall pump','Epiphytes','Misting system'],
      params:[['6.8','pH'],['85%','Humidity'],['24 °C','Water'],['26 °C','Air'],['10','Nitrate']],
      livestock:[['Endler livebearers','Water section','9'],['Isopods (Dwarf White)','Land section','']],
      plants:[['Ferns & Peperomia','Land section','12'],['Riparium Pothos roots','Waterline filtration',''],['Java moss wall','Waterfall face','']],
      log:[['Misting nozzles cleaned','Even coverage restored','19 Jul'],['Pruned Pothos, roots trimmed','Flow through roots improved','05 Jul']],
      awards:[] },
    { name:'Moss Hollow', type:'Terrarium', subtitle:'Bioactive', volume:0, dims:'45 × 45 × 60', started:'May 2025',
      notes:'Drainage layer, springtails and Powder Orange isopods, LED grow light.',
      tags:['Bioactive','Drainage layer','Springtails','LED grow light'],
      params:[['90%','Humidity'],['25 °C','Day'],['20 °C','Night'],['12 h','Photoperiod'],['—','Water']],
      livestock:[['Powder Orange isopods','Colony',''],['Springtails','Clean-up crew','']],
      plants:[['Cushion & mood moss','Ground cover',''],['Fittonia & Begonia','Mid-story colour','7'],['Epiphytic mini orchid','Feature branch','1']],
      log:[['Misted heavily, fed isopods','Leaf litter topped up','17 Jul']],
      awards:[] }
  ];
  var currentTank = -1;
  var tanksLoading = IS_LIVE; // true until the first live fetch resolves

  // ===== Supabase helpers for My Aquariums (no-ops in demo mode, where sb is null) =====
  async function dbInsertRow(table, row){
    if (!sb) return { data: null, error: null };
    return await sb.from(table).insert(row).select().single();
  }
  async function dbUpdateRow(table, id, patch){
    if (!sb) return { error: null };
    return await sb.from(table).update(patch).eq('id', id);
  }
  async function dbDeleteRow(table, id){
    if (!sb) return { error: null };
    return await sb.from(table).delete().eq('id', id);
  }

  function fmtLogDate(iso){
    var d = new Date(iso);
    return d.getDate() + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
  }

  async function loadTanksFromDB(){
    if (!sb || !window.currentMember) { tanksLoading = false; return; }
    var res = await sb.from('tanks')
      .select('*, tank_tags(*), tank_params(*), tank_livestock(*), tank_plants(*), tank_log(*), tank_photos!tank_id(*)')
      .eq('owner_id', window.currentMember.id)
      .order('created_at', { ascending: true });
    tanksLoading = false;
    if (res.error) { renderTanks(); return; }
    if (!res.data) { renderTanks(); return; }
    // Defensive: if we already have tanks showing locally and this refresh comes
    // back with zero rows, treat it as a failed/racy fetch rather than trusting
    // it — never let a suspicious empty response wipe data that's already correct
    // on screen (this is what caused newly-created tanks to vanish before).
    if (res.data.length === 0 && tanks.length > 0) { return; }
    tanks.length = 0;
    res.data.forEach(function(row){
      var params = (row.tank_params || []).slice().sort(function(a,b){ return (a.sort_order||0) - (b.sort_order||0); })
        .map(function(p){ var arr = [p.value, p.label]; arr._id = p.id; return arr; });
      var livestock = (row.tank_livestock || []).map(function(l){ var arr = [l.name, l.note || '', l.qty || '']; arr._id = l.id; return arr; });
      var plants = (row.tank_plants || []).map(function(p){ var arr = [p.name, p.note || '', p.qty || '']; arr._id = p.id; return arr; });
      var log = (row.tank_log || []).slice().sort(function(a,b){ return new Date(b.logged_at) - new Date(a.logged_at); })
        .map(function(l){ var arr = [l.entry, l.note || '', fmtLogDate(l.logged_at)]; arr._id = l.id; return arr; });
      var photos = (row.tank_photos || []).slice().sort(function(a,b){ return new Date(b.created_at) - new Date(a.created_at); })
        .map(function(p){ return { id: p.id, url: p.url, path: p.path }; });
      tanks.push({
        id: row.id, name: row.name, type: row.type, subtitle: row.subtitle || '',
        volume: row.volume || 0, dims: row.dims || '—', started: row.started || '', notes: row.notes || '',
        shape: row.shape || 'rect',
        started_on: row.started_on || null,
        filter: row.filter || '', light: row.light || '',
        length_cm: row.length_cm || 0, width_cm: row.width_cm || 0, height_cm: row.height_cm || 0,
        displacement: (typeof row.displacement === 'number') ? row.displacement : 12,
        substrate: row.substrate || '', co2: row.co2 || '', water_source: row.water_source || '',
        archived: !!row.archived,
        tags: (row.tank_tags || []).map(function(t){ return t.label; }),
        params: params, livestock: livestock, plants: plants, log: log, awards: [], photos: photos,
        cover_photo_id: row.cover_photo_id || null
      });
    });
    // Tanks and award entries load in parallel and this rebuild resets every
    // tank's `awards` to []. If entries won the race (they usually do — it's the
    // lighter query) their tank links were just wiped, so re-attach them from the
    // rows we already hold rather than re-fetching. Also covers the re-runs of
    // this function after a tank create/edit.
    applyEntriesToTanks();
    renderTanks();
    if (currentTank >= 0 && currentTank < tanks.length) renderDetail();
    if (window.renderMemberTimeline) window.renderMemberTimeline();
    if (window.checkBadgeChanges) window.checkBadgeChanges();
  }


  function escT(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function numberWord(n){
    var w = ['No','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve'];
    return n < w.length ? w[n] : String(n);
  }
  function todayShort(){
    var d = new Date();
    return d.getDate() + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
  }

  function tankSummary(){
    var counts = {};
    tanks.forEach(function(t){ counts[t.type] = (counts[t.type]||0)+1; });
    return Object.keys(counts).map(function(k){ return counts[k] + ' ' + k.toLowerCase(); }).join(', ');
  }

  function coverUrl(t){
    if (!t.cover_photo_id || !t.photos) return null;
    var p = t.photos.find(function(ph){ return ph.id === t.cover_photo_id; });
    return p ? p.url : null;
  }

  // ===== volume maths =====
  // Everything downstream (dosing, water changes, medication) leans on volume,
  // and the number printed on the box is almost never the number in the tank.
  // Gross is the glass; net subtracts substrate and hardscape displacement.
  var SHAPE_LABEL = { rect:'Rectangular', cube:'Cube', bowfront:'Bowfront', cylinder:'Cylinder' };
  function grossLitres(shape, l, w, h){
    if (shape === 'cylinder'){
      if (!l || !h) return 0;
      var r = l / 2;                     // length field doubles as diameter
      return (Math.PI * r * r * h) / 1000;
    }
    if (shape === 'cube'){
      if (!l) return 0;
      return (l * l * l) / 1000;
    }
    if (!l || !w || !h) return 0;
    var v = (l * w * h) / 1000;
    // A bowfront isn't a box: the curve adds glass but the standard rule of
    // thumb is to take the max dimensions and knock off ~15%.
    return shape === 'bowfront' ? v * 0.85 : v;
  }
  function dimsString(shape, l, w, h){
    if (shape === 'cylinder') return l && h ? ('Ø' + l + ' × ' + h) : '';
    if (shape === 'cube') return l ? (l + ' × ' + l + ' × ' + l) : '';
    return (l && w && h) ? (l + ' × ' + w + ' × ' + h) : '';
  }
  // Older tanks were saved with only a free-text dims string. Pull numbers back
  // out of it so the calculator isn't blank the first time someone edits them.
  function parseDims(str){
    var nums = String(str || '').match(/[\d.]+/g);
    if (!nums) return null;
    nums = nums.map(parseFloat).filter(function(n){ return n > 0; });
    if (nums.length < 2) return null;
    if (nums.length === 2) return { l: nums[0], w: 0, h: nums[1] };
    return { l: nums[0], w: nums[1], h: nums[2] };
  }
  function netLitres(t){
    // Only meaningful when the volume came from the glass dimensions. If someone
    // typed a figure by hand it may already be the water volume, and quietly
    // shaving 12% off it would be worse than saying nothing.
    if (!t.length_cm || !t.volume) return 0;
    var d = (typeof t.displacement === 'number') ? t.displacement : 12;
    return Math.round(t.volume * (1 - d / 100));
  }

  // ===== My Aquariums toolbar state =====
  var tankView = { type: 'all', sort: 'added', showArchived: false };

  function visibleTanks(){
    // Keep the original array index alongside each tank: every click handler,
    // openTank() and currentTank all address tanks[] directly, so filtering must
    // not renumber anything.
    var out = tanks.map(function(t, i){ return { t: t, i: i }; }).filter(function(e){
      if (!tankView.showArchived && e.t.archived) return false;
      if (tankView.type !== 'all' && e.t.type !== tankView.type) return false;
      return true;
    });
    if (tankView.sort === 'name') out.sort(function(a,b){ return a.t.name.localeCompare(b.t.name); });
    else if (tankView.sort === 'volume') out.sort(function(a,b){ return (b.t.volume||0) - (a.t.volume||0); });
    else if (tankView.sort === 'logs') out.sort(function(a,b){ return b.t.log.length - a.t.log.length; });
    return out;
  }

  function syncTankToolbar(){
    var sel = document.getElementById('tank-filter-type');
    if (!sel) return;
    // Only offer types the member actually keeps — an empty filter option is
    // just a dead end.
    var types = [];
    tanks.forEach(function(t){ if (types.indexOf(t.type) === -1) types.push(t.type); });
    types.sort();
    var cur = tankView.type;
    sel.innerHTML = '<option value="all">All types</option>' +
      types.map(function(x){ return '<option value="' + escT(x) + '">' + escT(x) + '</option>'; }).join('');
    sel.value = (cur === 'all' || types.indexOf(cur) >= 0) ? cur : 'all';
    tankView.type = sel.value;

    var archCount = tanks.filter(function(t){ return t.archived; }).length;
    var arch = document.getElementById('tank-arch-toggle');
    arch.style.display = archCount ? 'inline-flex' : 'none';
    arch.textContent = tankView.showArchived ? 'Hide archived' : 'Show archived (' + archCount + ')';
    arch.classList.toggle('active', tankView.showArchived);
    arch.setAttribute('aria-pressed', tankView.showArchived ? 'true' : 'false');
    document.getElementById('tank-toolbar').style.display = tanks.length > 1 ? 'flex' : 'none';
  }

  // ===== parameter library =====
  // Keyed by the uppercase label already used in tank_params, so existing rows
  // (PH, TEMP, TDS) light up without a data migration. Anything not in here is
  // still allowed — it just renders without a unit or a safe band.
  // `range` is the general freshwater band; `byType` narrows it where the tank
  // type genuinely changes what "good" means. `critical` params are the ones
  // where any reading above zero means act today, not adjust gradually.
  var PARAM_LIB = {
    PH:   { name:'pH',   unit:'',    range:[6.4,7.8], dp:1,
            byType:{ Marine:[8.0,8.4], Shrimp:[6.2,7.5], Blackwater:[4.5,6.5], Brackish:[7.6,8.4] } },
    TEMP: { name:'Temp', unit:'°C',  range:[22,27],   dp:1,
            byType:{ Shrimp:[20,25], Marine:[24,27], Terrarium:[20,28], Vivarium:[20,28] } },
    KH:   { name:'KH',   unit:'dKH', range:[2,8],     dp:1,
            byType:{ Marine:[7,11], Shrimp:[1,5], Blackwater:[0,3] } },
    GH:   { name:'GH',   unit:'dGH', range:[4,12],    dp:1,
            byType:{ Shrimp:[4,8], Blackwater:[0,4] } },
    NH3:  { name:'Ammonia', unit:'ppm', range:[0,0], dp:2, critical:true },
    NO2:  { name:'Nitrite', unit:'ppm', range:[0,0], dp:2, critical:true },
    NO3:  { name:'Nitrate', unit:'ppm', range:[0,30], dp:0,
            byType:{ Marine:[0,10], Shrimp:[0,20] } },
    PO4:  { name:'Phosphate', unit:'ppm', range:[0,1.5], dp:2, byType:{ Marine:[0,0.1] } },
    TDS:  { name:'TDS',  unit:'ppm', range:[100,300], dp:0, byType:{ Shrimp:[120,250] } },
    // Copper is fatal to shrimp and inverts at doses fish shrug off, so it gets
    // the same treatment as ammonia rather than a soft range.
    CU:   { name:'Copper', unit:'ppm', range:[0,0], dp:2, critical:true },
    ALK:  { name:'Alkalinity', unit:'dKH', range:[7,11], dp:1 },
    CA:   { name:'Calcium', unit:'ppm', range:[400,450], dp:0 },
    MG:   { name:'Magnesium', unit:'ppm', range:[1250,1350], dp:0 },
    SAL:  { name:'Salinity', unit:'ppt', range:[33,35], dp:1, byType:{ Brackish:[5,15] } },
    HUM:  { name:'Humidity', unit:'%', range:[60,90], dp:0 }
  };

  // What a new tank starts with. Freshwater tanks begin with the cycling set —
  // a tank on day one is cycling, and ammonia and nitrite are the readings that
  // matter until it isn't.
  var STARTER_PARAMS = {
    'Freshwater': ['PH','TEMP','NH3','NO2','NO3'],
    'Aquascape':  ['PH','TEMP','KH','GH','NO3','PO4'],
    'Shrimp':     ['TEMP','GH','KH','TDS','PH','CU'],
    'Marine':     ['TEMP','SAL','ALK','CA','MG'],
    'Brackish':   ['TEMP','SAL','PH','NO3'],
    'Blackwater': ['PH','TEMP','TDS','KH'],
    'Paludarium': ['TEMP','PH','HUM'],
    'Vivarium':   ['TEMP','HUM'],
    'Terrarium':  ['TEMP','HUM']
  };
  function starterParams(type){ return (STARTER_PARAMS[type] || STARTER_PARAMS['Freshwater']).slice(); }

  // Labels are free text and always have been, so map the spellings people
  // actually type onto the canonical keys.
  var PARAM_ALIAS = {
    'TEMPERATURE':'TEMP', 'TEMP.':'TEMP', 'WATER TEMP':'TEMP', '°C':'TEMP',
    'AMMONIA':'NH3', 'NH4':'NH3', 'NH3/NH4':'NH3',
    'NITRITE':'NO2', 'NITRATE':'NO3', 'NITRATES':'NO3',
    'PHOSPHATE':'PO4', 'PHOSPHATES':'PO4',
    'HUMIDITY':'HUM', 'RH':'HUM',
    'ALKALINITY':'ALK', 'DKH':'KH',
    'CALCIUM':'CA', 'MAGNESIUM':'MG', 'COPPER':'CU',
    'SALINITY':'SAL', 'SG':'SAL',
    'HARDNESS':'GH', 'CARBONATE HARDNESS':'KH'
  };
  function paramKey(label){
    var k = String(label || '').trim().toUpperCase();
    return PARAM_ALIAS[k] || k;
  }
  function paramDef(label){ return PARAM_LIB[paramKey(label)] || null; }
  function paramRange(label, tankType){
    var def = paramDef(label);
    if (!def) return null;
    if (def.byType && def.byType[tankType]) return def.byType[tankType];
    return def.range;
  }
  function isUntested(v){
    var s = String(v == null ? '' : v).trim();
    return s === '' || s === '—' || s === '-' || s === '–';
  }
  // Readings get typed in as "7.2", "7,2", "~25", "25 °C" — pull the number out
  // rather than rejecting anything that isn't clean.
  function paramNumber(v){
    var m = String(v).replace(',', '.').match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  }
  function paramStatus(label, value, tankType){
    if (isUntested(value)) return { state:'none', text:'Not tested yet' };
    var def = paramDef(label);
    var range = paramRange(label, tankType);
    var n = paramNumber(value);
    if (!def || !range || n === null) return { state:'plain', text:'' };
    if (def.critical){
      if (n > 0) return { state:'bad', text:'Should be zero', critical:true };
      return { state:'ok', text:'Zero — good' };
    }
    var lo = range[0], hi = range[1];
    if (n >= lo && n <= hi) return { state:'ok', text:'In range' };
    // A hair outside the band is a nudge, not an emergency. 15% of the band's
    // width (or of the limit itself for bands that start at zero) is the margin.
    var span = (hi - lo) || hi || 1;
    var margin = Math.abs(span) * 0.15;
    var over = n > hi;
    var drift = over ? n - hi : lo - n;
    var word = over ? 'Above' : 'Below';
    return {
      state: drift <= margin ? 'warn' : 'bad',
      text: word + ' ' + (over ? hi : lo) + (def.unit ? ' ' + def.unit : '')
    };
  }
  function paramDisplay(label, value){
    var def = paramDef(label);
    if (isUntested(value)) return { value:'Not tested yet', unit:'' };
    var s = String(value).trim();
    // Plenty of existing readings were typed as "26 °C" or "14°". Only append
    // the unit chip when the value is a bare number, or it reads "26 °C °C".
    var bare = /^-?\d+(\.\d+)?$/.test(s.replace(',', '.'));
    return { value: s, unit: (bare && def) ? def.unit : '' };
  }
  function paramTitle(label){
    var def = paramDef(label);
    // Respect what the member typed if it isn't one of the known presets —
    // "Photoperiod" shouldn't come back as "PHOTOPERIOD".
    return def ? def.name : String(label);
  }

  function monthYear(iso){
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()] + ' ' + d.getFullYear();
  }
  // Maturity is what people actually want to know — "14 months" says more about
  // a tank's biology than the date it was filled.
  function tankAge(iso){
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var now = new Date();
    var days = Math.floor((now - d) / 86400000);
    if (days < 0) return 'Not set up yet';
    if (days < 14) return days + (days === 1 ? ' day old' : ' days old') + ' — still cycling';
    if (days < 60) return Math.floor(days / 7) + ' weeks old';
    var months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
    if (now.getDate() < d.getDate()) months--;
    if (months < 12) return months + ' months mature';
    var years = Math.floor(months / 12), rem = months % 12;
    return years + (years === 1 ? ' year' : ' years') + (rem ? ' ' + rem + ' month' + (rem === 1 ? '' : 's') : '') + ' mature';
  }

  function renderTanks(){
    var grid = document.getElementById('tank-grid');
    syncTankToolbar();
    var vis = visibleTanks();
    grid.innerHTML = vis.map(function(entry){
      var t = entry.t, i = entry.i;
      var st = TYPE_STYLE[t.type] || TYPE_STYLE['Freshwater'];
      var live = t.livestock.reduce(function(a, l){ var n = parseInt(l[2],10); return a + (isNaN(n) ? (l[2] ? 1 : 0) : n); }, 0);
      var liveLabel = (t.type === 'Shrimp' || (/shrimp|caridina|neocaridina/i.test(t.livestock.map(function(l){return l[0];}).join(' ')) && t.type==='Freshwater')) ? 'Shrimp' : (t.type==='Terrarium' ? 'Fauna' : 'Fish');
      var cover = coverUrl(t);
      var thumbInner = cover
        ? '<img src="' + escT(cover) + '" alt="' + escT(t.name) + '" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0">'
        : ICONS[st[2]];
      // A div, not a <button>: the heart control inside is itself a button, and
      // nested buttons are invalid HTML — the parser silently closes the outer
      // one and throws the rest of the card out into the grid. This is the same
      // pattern the directory cards already use.
      return '<div class="tank-card' + (t.archived ? ' is-archived' : '') + '" role="button" tabindex="0" data-tank="' + i + '">' +
        '<div class="tank-thumb" style="background:linear-gradient(135deg,' + st[0] + ',' + st[1] + ')">' +
          '<span class="cat-pill" style="z-index:1">' + escT(t.type) + (t.subtitle ? ' · ' + escT(t.subtitle) : '') + '</span>' +
          (t.archived ? '<span class="arch-pill">Archived</span>' : '') + thumbInner +
        '</div><div class="tank-body"><h4>' + escT(t.name) + '</h4>' +
        '<div class="meta">' + (t.volume ? t.volume + ' ℓ · ' : '') + escT(t.dims) + ' cm · started ' + escT(t.started) + '</div>' +
        '<div class="tank-stats"><div><b>' + (live || '—') + '</b><span>' + liveLabel + '</span></div>' +
        '<div><b>' + t.plants.length + '</b><span>Plants</span></div>' +
        '<div><b>' + t.log.length + '</b><span>Logs</span></div>' +
        (heartHtml({ id: t.id, mine: true }, false) ? '<div class="tank-heart">' + heartHtml({ id: t.id, mine: true }, false) + '</div>' : '') +
        '</div></div></div>';
    }).join('');
    grid.querySelectorAll('.tank-card').forEach(function(card){
      card.addEventListener('click', function(){ openTank(parseInt(card.getAttribute('data-tank'),10)); });
    });
    document.getElementById('tank-empty').style.display = tanks.length ? 'none' : 'block';
    grid.style.display = vis.length ? 'grid' : 'none';
    // Zero tanks and zero *matching* tanks are different problems and deserve
    // different messages.
    document.getElementById('tank-nomatch').style.display = (tanks.length && !vis.length) ? 'block' : 'none';
    var countLabel = document.getElementById('tank-count-label');
    if (countLabel){
      var litres = vis.reduce(function(a, e){ return a + (e.t.volume || 0); }, 0);
      countLabel.textContent = vis.length
        ? vis.length + ' tank' + (vis.length === 1 ? '' : 's') + (litres ? ' · ' + litres.toLocaleString('en-ZA') + ' ℓ total' : '')
        : '';
    }
    if (!tanks.length){
      document.getElementById('tank-empty-h4').textContent = tanksLoading ? 'Loading your aquariums…' : 'No aquariums yet';
      document.getElementById('tank-empty-p').textContent = tanksLoading ? 'Fetching your tanks from your account.' : 'Add your first tank to start logging maintenance, parameters and award entries.';
      document.getElementById('tank-empty-btn').style.display = tanksLoading ? 'none' : 'inline-flex';
    }
    document.getElementById('tanks-title').textContent = tanksLoading ? 'Loading…' : (tanks.length ? numberWord(tanks.length) + ' tank' + (tanks.length===1?'':'s') + ' and counting' : 'Start your collection');
    document.getElementById('dash-tank-count').textContent = tanks.length;
    document.getElementById('dash-tank-label').textContent = 'Aquariums · ' + (tanks.length ? tankSummary() : 'none yet');

    // Compact "My Aquariums" preview on the dashboard — same tanks array, same
    // cover/type styling as the full grid, just fewer fields per card and
    // capped to 3 so the hub stays a hub rather than a second Tanks page.
    var dashGrid = document.getElementById('dash-tanks-preview');
    if (dashGrid){
      var dashActive = tanks.filter(function(t){ return !t.archived; });
      if (!dashActive.length){
        dashGrid.innerHTML = '<div class="reg-empty" style="padding:20px;grid-column:1/-1">' +
          (tanksLoading ? 'Loading your aquariums…'
            : (tanks.length ? 'All your aquariums are archived — open My Aquariums to bring one back.'
                            : 'No aquariums yet — add your first tank to see it here.')) + '</div>';
      } else {
        dashGrid.innerHTML = tanks.filter(function(t){ return !t.archived; }).slice(0, 3).map(function(t){
          var st = TYPE_STYLE[t.type] || TYPE_STYLE['Freshwater'];
          var cover = coverUrl(t);
          var thumbInner = cover
            ? '<img src="' + escT(cover) + '" alt="' + escT(t.name) + '" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0">'
            : ICONS[st[2]];
          var idx = tanks.indexOf(t);
          return '<div class="tank-card" role="button" tabindex="0" data-dash-tank="' + idx + '">' +
            '<div class="tank-thumb" style="background:linear-gradient(135deg,' + st[0] + ',' + st[1] + ')">' +
              '<span class="cat-pill" style="z-index:1">' + escT(t.type) + '</span>' + thumbInner +
            '</div><div class="tank-body"><h4>' + escT(t.name) + '</h4>' +
            '<div class="meta">' + (t.volume ? t.volume + ' ℓ · ' : '') + escT(t.dims) + ' cm</div></div></div>';
        }).join('');
        dashGrid.querySelectorAll('[data-dash-tank]').forEach(function(card){
          card.addEventListener('click', function(){
            show('tanks');
            openTank(parseInt(card.getAttribute('data-dash-tank'), 10));
          });
        });
      }
    }

    // A member opening #/tank/<uuid> cold arrives before the fetch resolves, so
    // applyRoute() parked the key and showed the tanks list. This is the earliest
    // point the array is known to be populated — renderTanks() is called on every
    // exit path of loadTanksFromDB(), including the error and empty ones, so a tank
    // that genuinely isn't there stops waiting rather than hanging on the list view
    // forever. Deliberately last in the function, after the grid has rendered.
    if (pendingTankKey){
      var pi = tankIndexFromKey(pendingTankKey);
      if (pi >= 0){
        pendingTankKey = null;
        suppressPush = true;
        try { openTank(pi); } finally { suppressPush = false; }
        // replace, not push: this is the URL the member already typed or tapped,
        // so it must not become a second entry they have to press back through.
        replaceRoute('tank-detail');
      } else if (!tanksLoading){
        pendingTankKey = null;
        replaceRoute('tanks');
      }
    }
  }

  var CHILD_TABLE = { livestock:'tank_livestock', plants:'tank_plants', log:'tank_log' };
  function editableRows(items, icon, containerId, listKey){
    var el = document.getElementById(containerId);
    if (!items.length){
      el.innerHTML = '<div class="reg-empty" style="padding:22px">Nothing here yet — add the first one below.</div>';
      return;
    }
    el.innerHTML = items.map(function(it, idx){
      return '<div class="row"><div class="row-icon">' + icon + '</div>' +
        '<div class="row-body"><b>' + escT(it[0]) + '</b><span>' + escT(it[1] || '') + '</span></div>' +
        (it[2] ? '<div class="row-end"><b style="color:var(--deep)">' + escT(it[2]) + '</b></div>' : '') +
        '<button class="rm-btn" data-idx="' + idx + '" aria-label="Remove ' + escT(it[0]) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>';
    }).join('');
    el.querySelectorAll('.rm-btn').forEach(function(b){
      b.addEventListener('click', async function(){
        var idx = parseInt(b.getAttribute('data-idx'), 10);
        var it = tanks[currentTank][listKey][idx];
        if (sb && it._id){
          b.disabled = true;
          var res = await dbDeleteRow(CHILD_TABLE[listKey], it._id);
          if (res.error){ popToast('Could not remove — try again'); b.disabled = false; return; }
        }
        tanks[currentTank][listKey].splice(idx, 1);
        popToast('Removed ' + it[0]);
        renderDetail(); renderTanks();
      });
    });
  }

  // ===== setup panel =====
  // The tag pills lose the label — "RO remineralised" as a bare chip doesn't
  // tell you it's the water source. These are the same facts with their names
  // attached, and rows with nothing in them are left out entirely.
  function renderSpec(t){
    var el = document.getElementById('td-spec');
    if (!el) return;
    var net = netLitres(t);
    var age = tankAge(t.started_on);
    var rows = [
      ['Volume', t.volume ? t.volume + ' ℓ' : '', net && net !== t.volume ? '≈' + net + ' ℓ of water after ' + (t.displacement || 12) + '% displacement' : ''],
      ['Dimensions', t.dims && t.dims !== '—' ? t.dims + ' cm' : '', SHAPE_LABEL[t.shape || 'rect'] || ''],
      ['Set up', t.started || '', age],
      ['Filter', t.filter || '', ''],
      ['Lighting', t.light || '', ''],
      ['Substrate', t.substrate || '', ''],
      ['CO₂', t.co2 || '', ''],
      ['Water source', t.water_source || '', '']
    ].filter(function(r){ return r[1]; });
    if (!rows.length){
      el.innerHTML = '<div class="spec-item" style="grid-column:1/-1"><dd style="font-weight:500;color:var(--ink-soft)">Nothing recorded yet — use Edit tank to fill in the setup.</dd></div>';
      return;
    }
    el.innerHTML = rows.map(function(r){
      return '<div class="spec-item"><dt>' + escT(r[0]) + '</dt><dd>' + escT(r[1]) +
        (r[2] ? '<small>' + escT(r[2]) + '</small>' : '') + '</dd></div>';
    }).join('');
  }

  // ===== critical parameter alert =====
  // Ammonia, nitrite and copper aren't "a bit high" problems. A coloured dot on
  // a tile is easy to scroll past, so they get said out loud.
  function renderParamAlert(t){
    var el = document.getElementById('td-param-alert');
    if (!el) return;
    var bad = t.params.filter(function(p){
      var s = paramStatus(p[1], p[0], t.type);
      return s.critical;
    });
    if (!bad.length){ el.innerHTML = ''; return; }
    var names = bad.map(function(p){ return paramTitle(p[1]) + ' at ' + p[0]; });
    var advice = bad.some(function(p){ return String(p[1]).toUpperCase() === 'CU'; })
      ? 'Copper is lethal to shrimp and other invertebrates even in trace amounts — find the source before anything else.'
      : 'Test again to confirm, then water change and hold off feeding. Livestock is at risk while this reads above zero.';
    el.innerHTML = '<div class="param-alert">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 9v5M12 17.5v.01"/><path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>' +
      '<div><b>Act today:</b> ' + escT(names.join(', ')) + '. ' + escT(advice) + '</div></div>';
  }

  function renderDetail(){
    var t = tanks[currentTank];
    document.getElementById('td-name').textContent = t.name;
    // Show the water volume alongside the tank volume — it's the figure that
    // matters for dosing, and it's never the one on the box.
    var net = netLitres(t);
    var volBit = t.volume ? (t.volume + ' ℓ' + (net && net !== t.volume ? ' (≈' + net + ' ℓ water)' : '') + ' · ') : '';
    document.getElementById('td-meta').textContent = volBit + t.dims + ' cm · ' + t.type + (t.subtitle ? ' — ' + t.subtitle : '') + ' · started ' + t.started;
    setArchBtn(t);
    document.getElementById('td-notes').textContent = t.notes || '';
    document.getElementById('td-tags').innerHTML = t.tags.map(function(x){ return '<span class="tag">' + escT(x) + '</span>'; }).join('');
    document.getElementById('td-params').innerHTML = t.params.map(function(p, i){
      var status = paramStatus(p[1], p[0], t.type);
      var disp = paramDisplay(p[1], p[0]);
      var cls = (status.state === 'plain') ? '' : ' st-' + status.state;
      var statusRow = status.text
        ? '<div class="p-status st-' + status.state + '"><i></i>' + escT(status.text) + '</div>'
        : '';
      return '<div class="param' + cls + '" data-p="' + i + '">' +
        '<div class="param-view" tabindex="0" role="button" aria-label="Edit ' + escT(paramTitle(p[1])) + '">' +
          '<b>' + escT(disp.value) + (disp.unit ? '<span class="p-unit">' + escT(disp.unit) + '</span>' : '') + '</b>' +
          '<span>' + escT(paramTitle(p[1])) + '</span>' + statusRow +
        '</div>' +
        '<div class="param-edit">' +
          '<input type="text" class="param-input" value="' + (isUntested(p[0]) ? '' : escT(p[0])) + '" aria-label="New reading for ' + escT(paramTitle(p[1])) + '">' +
          '<div class="param-edit-actions">' +
            '<button class="param-save" aria-label="Save"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg></button>' +
            '<button class="param-cancel" aria-label="Cancel"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
            '<button class="param-remove" aria-label="Remove ' + escT(p[1]) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('') + '<button class="param-add" id="param-add-btn" aria-label="Add a parameter"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg><span>Add parameter</span></button>';

    document.querySelectorAll('#td-params .param').forEach(function(tile){
      var i = parseInt(tile.getAttribute('data-p'), 10);
      var viewEl = tile.querySelector('.param-view');
      var editEl = tile.querySelector('.param-edit');
      var input = tile.querySelector('.param-input');

      function enterEdit(){
        document.querySelectorAll('#td-params .param.editing').forEach(function(other){ if (other !== tile) cancelEdit(other); });
        tile.classList.add('editing');
        viewEl.style.display = 'none';
        editEl.style.display = 'flex';
        var cur = tanks[currentTank].params[i][0];
        input.value = isUntested(cur) ? '' : cur;
        input.focus(); input.select();
      }
      function cancelEdit(target){
        target = target || tile;
        target.classList.remove('editing');
        target.querySelector('.param-view').style.display = '';
        target.querySelector('.param-edit').style.display = 'none';
      }
      function saveEdit(){
        var p = tanks[currentTank].params[i];
        var v = input.value.trim();
        if (!v || v === p[0]){ cancelEdit(); return; }
        var t = tanks[currentTank];
        var doSave = async function(){
          if (sb && p._id){
            var res = await dbUpdateRow('tank_params', p._id, { value: v });
            if (res.error){ popToast('Could not save — try again'); return; }
            var logRes = await dbInsertRow('tank_log', { tank_id: t.id, entry: 'Logged ' + p[1] + ': ' + v, note: 'Parameter update' });
            if (!logRes.error && logRes.data){
              var la = [logRes.data.entry, logRes.data.note || '', fmtLogDate(logRes.data.logged_at)];
              la._id = logRes.data.id;
              t.log.unshift(la);
            }
          } else {
            t.log.unshift(['Logged ' + p[1] + ': ' + v, 'Parameter update', todayShort()]);
          }
          p[0] = v;
          popToast(p[1] + ' updated to ' + v);
          renderDetail(); renderTanks();
        };
        doSave();
      }
      function removeParam(){
        var p = tanks[currentTank].params[i];
        var label = p[1];
        var doRemove = async function(){
          if (sb && p._id){
            var res = await dbDeleteRow('tank_params', p._id);
            if (res.error){ popToast('Could not remove — try again'); return; }
          }
          tanks[currentTank].params.splice(i, 1);
          popToast(label + ' removed from this tank');
          renderDetail(); renderTanks();
        };
        doRemove();
      }

      viewEl.addEventListener('click', enterEdit);
      viewEl.addEventListener('keydown', function(e){ if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); enterEdit(); } });
      tile.querySelector('.param-save').addEventListener('click', function(e){ e.stopPropagation(); saveEdit(); });
      tile.querySelector('.param-cancel').addEventListener('click', function(e){ e.stopPropagation(); cancelEdit(); });
      tile.querySelector('.param-remove').addEventListener('click', function(e){ e.stopPropagation(); removeParam(); });
      input.addEventListener('click', function(e){ e.stopPropagation(); });
      input.addEventListener('keydown', function(e){
        if (e.key === 'Enter'){ e.preventDefault(); saveEdit(); }
        else if (e.key === 'Escape'){ e.preventDefault(); cancelEdit(); }
      });
    });

    var addBtn = document.getElementById('param-add-btn');
    if (addBtn) addBtn.addEventListener('click', function(){
      var form = document.createElement('div');
      form.className = 'param-new';
      form.innerHTML =
        '<input type="text" class="param-new-label" list="param-preset-list" placeholder="Parameter (e.g. GH)" maxlength="14">' +
        '<datalist id="param-preset-list">' +
          Object.keys(PARAM_LIB).map(function(k){
            return '<option value="' + k + '">' + escT(PARAM_LIB[k].name) + (PARAM_LIB[k].unit ? ' (' + PARAM_LIB[k].unit + ')' : '') + '</option>';
          }).join('') +
        '</datalist>' +
        '<input type="text" class="param-new-value" placeholder="Value (e.g. 8)">' +
        '<div class="param-edit-actions" style="justify-content:center">' +
          '<button class="param-save" aria-label="Save new parameter"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg></button>' +
          '<button class="param-cancel" aria-label="Cancel"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
        '</div>';
      addBtn.replaceWith(form);
      var labelInput = form.querySelector('.param-new-label');
      var valueInput = form.querySelector('.param-new-value');
      labelInput.focus();
      function commitNew(){
        var label = labelInput.value.trim();
        var value = valueInput.value.trim();
        if (!label){ labelInput.focus(); return; }
        var t = tanks[currentTank];
        // A parameter can exist before it has a reading — the tile just says
        // "Not tested yet" until someone fills it in.
        var stored = label.toUpperCase();
        var entryText = value ? ('Added parameter ' + stored + ': ' + value) : ('Started tracking ' + stored);
        var doCreate = async function(){
          if (sb && t.id){
            var res = await dbInsertRow('tank_params', { tank_id: t.id, label: stored, value: value, sort_order: t.params.length });
            if (res.error){ popToast('Could not save — try again'); return; }
            var arr = [res.data.value, res.data.label]; arr._id = res.data.id;
            t.params.push(arr);
            var logRes = await dbInsertRow('tank_log', { tank_id: t.id, entry: entryText, note: 'Parameter added' });
            if (!logRes.error && logRes.data){
              var la = [logRes.data.entry, logRes.data.note || '', fmtLogDate(logRes.data.logged_at)]; la._id = logRes.data.id;
              t.log.unshift(la);
            }
          } else {
            t.params.push([value, stored]);
            t.log.unshift([entryText, 'Parameter added', todayShort()]);
          }
          popToast(paramTitle(stored) + ' added to this tank');
          renderDetail(); renderTanks();
        };
        doCreate();
      }
      form.querySelector('.param-save').addEventListener('click', commitNew);
      form.querySelector('.param-cancel').addEventListener('click', function(){ renderDetail(); });
      [labelInput, valueInput].forEach(function(inp){
        inp.addEventListener('keydown', function(e){
          if (e.key === 'Enter'){ e.preventDefault(); commitNew(); }
          else if (e.key === 'Escape'){ e.preventDefault(); renderDetail(); }
        });
      });
    });

    renderSpec(t);
    renderParamAlert(t);

    editableRows(t.livestock, fishRowIcon, 'td-livestock', 'livestock');
    editableRows(t.plants, plantRowIcon, 'td-plants', 'plants');
    editableRows(t.log, checkRowIcon, 'td-log', 'log');
    var aw = document.getElementById('td-awards');
    aw.innerHTML = t.awards.length ? t.awards.map(function(a){
      return '<div class="row"><div class="row-icon gold">' + trophyRowIcon + '</div>' +
        '<div class="row-body"><b>' + escT(a[0]) + '</b><span>' + escT(a[1]) + '</span></div>' +
        '<span class="badge ' + (a[2] === 'ok' ? 'ok' : 'pend') + '">' + (a[2] === 'ok' ? 'Approved' : 'Pending') + '</span></div>';
    }).join('') : '<div class="reg-empty" style="padding:22px">No entries from this tank yet — submit one from the Awards Program.</div>';

    renderPhotoGrid(t);
  }

  function renderPhotoGrid(t){
    var grid = document.getElementById('td-photo-grid');
    var empty = document.getElementById('td-photo-empty');
    if (!grid) return;
    var photos = t.photos || [];
    grid.innerHTML = photos.map(function(p){
      var isCover = t.cover_photo_id === p.id;
      return '<div class="photo-tile' + (isCover ? ' is-cover' : '') + '" data-photo-id="' + p.id + '">' +
        '<img src="' + escT(p.url) + '" alt="Photo of ' + escT(t.name) + '" loading="lazy">' +
        '<button class="photo-cover-btn" data-photo-id3="' + p.id + '" aria-label="' + (isCover ? 'Remove as card image' : 'Use as card image') + '"><svg viewBox="0 0 24 24" fill="' + (isCover ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2"><path d="M12 2 15 8 22 9 17 14 18 21 12 17.5 6 21 7 14 2 9 9 8 12 2Z"/></svg>' + (isCover ? 'Cover' : 'Set cover') + '</button>' +
        '<button class="photo-rm" data-photo-id2="' + p.id + '" aria-label="Delete photo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
      '</div>';
    }).join('');
    empty.style.display = photos.length ? 'none' : 'block';
    grid.querySelectorAll('img').forEach(function(img){
      img.addEventListener('click', function(){ openLightbox(img.src); });
    });
    grid.querySelectorAll('.photo-cover-btn').forEach(function(btn){
      btn.addEventListener('click', async function(e){
        e.stopPropagation();
        var photoId = btn.getAttribute('data-photo-id3');
        var newCoverId = t.cover_photo_id === photoId ? null : photoId;
        btn.disabled = true;
        if (sb && t.id){
          var res = await dbUpdateRow('tanks', t.id, { cover_photo_id: newCoverId });
          if (res.error){ popToast('Could not update card image — try again'); btn.disabled = false; return; }
        }
        t.cover_photo_id = newCoverId;
        renderPhotoGrid(t);
        renderTanks();
        popToast(newCoverId ? 'Set as this tank\u2019s card image' : 'Card image cleared — back to the default');
      });
    });
    grid.querySelectorAll('.photo-rm').forEach(function(btn){
      btn.addEventListener('click', async function(e){
        e.stopPropagation();
        var photoId = btn.getAttribute('data-photo-id2');
        var photo = (t.photos || []).find(function(p){ return String(p.id) === photoId; });
        if (!photo) return;
        btn.disabled = true;
        if (sb && photo.path){
          await sb.storage.from('tank-photos').remove([photo.path]);
          await dbDeleteRow('tank_photos', photo.id);
          if (t.cover_photo_id === photo.id && t.id){
            await dbUpdateRow('tanks', t.id, { cover_photo_id: null });
            t.cover_photo_id = null;
          }
        }
        t.photos = t.photos.filter(function(p){ return p.id !== photo.id; });
        renderPhotoGrid(t);
        renderTanks();
        popToast('Photo removed');
      });
    });
  }

  function openLightbox(src){
    document.getElementById('photo-lightbox-img').src = src;
    document.getElementById('photo-lightbox').classList.add('show');
  }
  function closeLightbox(){ document.getElementById('photo-lightbox').classList.remove('show'); }
  var lightboxEl = document.getElementById('photo-lightbox');
  if (lightboxEl){
    document.getElementById('photo-lightbox-close').addEventListener('click', closeLightbox);
    lightboxEl.addEventListener('click', function(e){ if (e.target === lightboxEl) closeLightbox(); });
    document.addEventListener('keydown', function(e){ if (e.key === 'Escape') closeLightbox(); });
  }

  var MAX_PHOTO_MB = 8;
  var photoUploadInput = document.getElementById('photo-upload-input');
  if (photoUploadInput) photoUploadInput.addEventListener('change', async function(){
    var files = Array.prototype.slice.call(this.files || []);
    this.value = ''; // allow re-selecting the same file later
    if (!files.length) return;
    var t = tanks[currentTank];
    var statusEl = document.getElementById('photo-upload-status');

    if (!sb || !window.currentMember){
      popToast('Photo uploads need a live account — this is demo mode');
      return;
    }
    if (!t.id){
      popToast('Save this tank before adding photos');
      return;
    }

    for (var i = 0; i < files.length; i++){
      var file = files[i];
      if (!file.type || file.type.indexOf('image/') !== 0){
        popToast(file.name + ' skipped — not an image');
        continue;
      }
      if (file.size > MAX_PHOTO_MB * 1024 * 1024){
        popToast(file.name + ' skipped — over ' + MAX_PHOTO_MB + 'MB');
        continue;
      }
      statusEl.textContent = 'Uploading ' + (i + 1) + ' of ' + files.length + '…';
      var safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
      var path = window.currentMember.id + '/' + t.id + '/' + Date.now() + '-' + safeName;
      try {
        var upRes = await sb.storage.from('tank-photos').upload(path, file);
        if (upRes.error){ popToast('Could not upload ' + file.name); continue; }
        var pub = sb.storage.from('tank-photos').getPublicUrl(path);
        var publicUrl = pub.data ? pub.data.publicUrl : '';
        var dbRes = await dbInsertRow('tank_photos', { tank_id: t.id, path: path, url: publicUrl, uploaded_by: window.currentMember.id });
        if (!dbRes.error && dbRes.data){
          t.photos = t.photos || [];
          t.photos.unshift({ id: dbRes.data.id, url: dbRes.data.url, path: dbRes.data.path });
          renderPhotoGrid(t);
        }
      } catch (err){
        popToast('Could not upload ' + file.name);
      }
    }
    statusEl.textContent = '';
    if (window.checkBadgeChanges) window.checkBadgeChanges();
  });

  function openTank(i){ currentTank = i; renderDetail(); show('tank-detail'); }

  // add livestock / plants / log
  function wireAdd(btnId, nameId, qtyId, listKey, label){
    document.getElementById(btnId).addEventListener('click', async function(){
      var nameEl = document.getElementById(nameId);
      var name = nameEl.value.trim();
      if (!name){ nameEl.focus(); return; }
      var qty = qtyId ? document.getElementById(qtyId).value.trim() : '';
      var btn = document.getElementById(btnId);
      var t = tanks[currentTank];

      if (sb && t.id){
        btn.disabled = true;
        var row = listKey === 'log'
          ? { tank_id: t.id, entry: name, note: 'Logged by you' }
          : { tank_id: t.id, name: name, note: 'Added ' + todayShort(), qty: qty };
        var res = await dbInsertRow(CHILD_TABLE[listKey], row);
        btn.disabled = false;
        if (res.error){ popToast('Could not save — try again'); return; }
        if (listKey === 'log'){
          var arr = [res.data.entry, res.data.note || '', fmtLogDate(res.data.logged_at)];
          arr._id = res.data.id;
          t.log.unshift(arr);
        } else {
          var arr2 = [res.data.name, res.data.note || '', res.data.qty || ''];
          arr2._id = res.data.id;
          t[listKey].push(arr2);
        }
      } else {
        if (listKey === 'log') t.log.unshift([name, 'Logged by you', todayShort()]);
        else t[listKey].push([name, 'Added ' + todayShort(), qty]);
      }
      nameEl.value = ''; if (qtyId) document.getElementById(qtyId).value = '';
      popToast(label + ' added');
      renderDetail(); renderTanks();
      if (window.checkBadgeChanges) window.checkBadgeChanges();
    });
  }
  wireAdd('ls-add', 'ls-name', 'ls-qty', 'livestock', 'Livestock');
  wireAdd('pl-add', 'pl-name', 'pl-qty', 'plants', 'Plant');
  wireAdd('log-add', 'log-text', null, 'log', 'Log entry');
  ['ls-name','pl-name','log-text'].forEach(function(id, i){
    document.getElementById(id).addEventListener('keydown', function(e){
      if (e.key === 'Enter') document.getElementById(['ls-add','pl-add','log-add'][i]).click();
    });
  });

  // ===== tank add/edit modal =====
  var tankModal = document.getElementById('tank-modal');
  var editingIdx = -1;
  // --- live volume calculator inside the modal ---
  var dimEls = ['tf-shape','tf-len','tf-wid','tf-hei','tf-disp'].map(function(id){ return document.getElementById(id); });
  var calcBox = document.getElementById('tf-volcalc');
  var calcText = document.getElementById('tf-volcalc-text');
  var calcApply = document.getElementById('tf-volcalc-apply');

  function shapeLabels(){
    var shape = document.getElementById('tf-shape').value;
    var wid = document.getElementById('tf-wid'), hei = document.getElementById('tf-hei');
    var lenL = document.getElementById('tf-len-label'), widL = document.getElementById('tf-wid-label'), heiL = document.getElementById('tf-hei-label');
    // The three boxes get reused rather than swapped out, so relabel and grey
    // out whatever the current shape doesn't need.
    if (shape === 'cylinder'){
      lenL.textContent = 'Diameter'; widL.textContent = 'Unused'; heiL.textContent = 'Height';
      wid.disabled = true; hei.disabled = false;
    } else if (shape === 'cube'){
      lenL.textContent = 'Side'; widL.textContent = 'Unused'; heiL.textContent = 'Unused';
      wid.disabled = true; hei.disabled = true;
    } else {
      lenL.textContent = 'Length'; widL.textContent = shape === 'bowfront' ? 'Max depth' : 'Width'; heiL.textContent = 'Height';
      wid.disabled = false; hei.disabled = false;
    }
  }
  function updateCalc(){
    shapeLabels();
    var shape = document.getElementById('tf-shape').value;
    var l = parseFloat(document.getElementById('tf-len').value) || 0;
    var w = parseFloat(document.getElementById('tf-wid').value) || 0;
    var h = parseFloat(document.getElementById('tf-hei').value) || 0;
    var disp = Math.min(60, Math.max(0, parseFloat(document.getElementById('tf-disp').value) || 0));
    var gross = grossLitres(shape, l, w, h);
    if (!gross){
      calcBox.classList.add('is-empty');
      calcText.textContent = 'Enter dimensions to work out the volume.';
      calcApply.style.display = 'none';
      calcApply.dataset.vol = '';
      return;
    }
    var g = Math.round(gross);
    var net = Math.round(gross * (1 - disp / 100));
    calcBox.classList.remove('is-empty');
    calcText.innerHTML = g + ' ℓ full to the rim' +
      '<small>About ' + net + ' ℓ of actual water once you allow ' + disp + '% for substrate and hardscape' +
      (shape === 'bowfront' ? ' — bowfront figures are an estimate' : '') + '.</small>';
    calcApply.style.display = 'inline-block';
    calcApply.dataset.vol = String(g);
  }
  dimEls.forEach(function(el){ if (el) el.addEventListener('input', updateCalc); });
  document.getElementById('tf-shape').addEventListener('change', updateCalc);
  calcApply.addEventListener('click', function(){
    if (calcApply.dataset.vol) document.getElementById('tf-volume').value = calcApply.dataset.vol;
  });

  function openTankModal(idx){
    editingIdx = (typeof idx === 'number') ? idx : -1;
    var t = editingIdx >= 0 ? tanks[editingIdx] : null;
    document.getElementById('tank-modal-title').textContent = t ? 'Edit ' + t.name : 'Add aquarium';
    document.getElementById('tf-name').value = t ? t.name : '';
    var typeSel = document.getElementById('tf-type');
    // A tank saved under a type that's since been retired (Biotope) would
    // otherwise fall through to the first option and get silently rewritten to
    // Freshwater on the next save. Keep its own type available to it.
    var legacyOpt = typeSel.querySelector('option[data-legacy]');
    if (legacyOpt) legacyOpt.remove();
    if (t && t.type && !Array.prototype.some.call(typeSel.options, function(o){ return o.value === t.type; })){
      var opt = document.createElement('option');
      opt.value = t.type; opt.textContent = t.type + ' (retired)';
      opt.setAttribute('data-legacy', '1');
      typeSel.appendChild(opt);
    }
    typeSel.value = t ? t.type : 'Freshwater';
    document.getElementById('tf-volume').value = t && t.volume ? t.volume : '';
    document.getElementById('tf-shape').value = (t && t.shape) || 'rect';
    // Fall back to digging the numbers out of the old free-text dims string.
    var d = t ? (t.length_cm ? { l: t.length_cm, w: t.width_cm || 0, h: t.height_cm || 0 } : parseDims(t.dims)) : null;
    document.getElementById('tf-len').value = d && d.l ? d.l : '';
    document.getElementById('tf-wid').value = d && d.w ? d.w : '';
    document.getElementById('tf-hei').value = d && d.h ? d.h : '';
    document.getElementById('tf-disp').value = (t && typeof t.displacement === 'number') ? t.displacement : 12;
    var startedOn = document.getElementById('tf-started-on');
    startedOn.value = (t && t.started_on) ? String(t.started_on).slice(0, 10) : '';
    // Tanks created before this field existed only have free text like
    // "Jul 2026" — show it so the member knows what they're replacing.
    var legacy = document.getElementById('tf-started-legacy');
    if (t && !t.started_on && t.started){
      legacy.textContent = 'Currently recorded as "' + t.started + '"';
      legacy.style.display = 'block';
    } else { legacy.style.display = 'none'; }
    document.getElementById('tf-filter').value = t ? (t.filter || '') : '';
    document.getElementById('tf-light').value = t ? (t.light || '') : '';
    document.getElementById('tf-substrate').value = t ? (t.substrate || '') : '';
    document.getElementById('tf-co2').value = t ? (t.co2 || '') : '';
    document.getElementById('tf-water').value = t ? (t.water_source || '') : '';
    document.getElementById('tf-notes').value = t ? (t.notes || '') : '';
    document.getElementById('tf-error').style.display = 'none';
    updateCalc();
    openLocked(tankModal);
    softFocus(document.getElementById('tf-name'), tankModal);
  }
  function closeTankModal(){ closeLocked(tankModal); }
  document.getElementById('tank-filter-type').addEventListener('change', function(){
    tankView.type = this.value; renderTanks();
  });
  document.getElementById('tank-sort').addEventListener('change', function(){
    tankView.sort = this.value; renderTanks();
  });
  document.getElementById('tank-arch-toggle').addEventListener('click', function(){
    tankView.showArchived = !tankView.showArchived; renderTanks();
  });

  document.getElementById('tank-add-btn').addEventListener('click', function(){ openTankModal(); });
  document.getElementById('fab-add-tank').addEventListener('click', function(){ show('tanks'); openTankModal(); });
  document.getElementById('td-edit-btn').addEventListener('click', function(){ openTankModal(currentTank); });
  document.getElementById('tank-modal-close').addEventListener('click', closeTankModal);
  document.getElementById('tf-cancel').addEventListener('click', closeTankModal);

  var tfSaving = false;
  document.getElementById('tf-save').addEventListener('click', async function(){
    if (tfSaving) return; // hard stop: a save is already in flight, ignore any extra click
    var name = document.getElementById('tf-name').value.trim();
    if (!name){ document.getElementById('tf-error').style.display = 'block'; return; }
    tfSaving = true;
    var shape = document.getElementById('tf-shape').value;
    var L = parseFloat(document.getElementById('tf-len').value) || 0;
    var W = parseFloat(document.getElementById('tf-wid').value) || 0;
    var H = parseFloat(document.getElementById('tf-hei').value) || 0;
    if (shape === 'cube'){ W = L; H = L; }
    var typedVol = parseInt(document.getElementById('tf-volume').value, 10) || 0;
    var startedOnVal = document.getElementById('tf-started-on').value || null;
    var existingStarted = (editingIdx >= 0 && tanks[editingIdx]) ? tanks[editingIdx].started : '';
    var data = {
      name: name,
      type: document.getElementById('tf-type').value,
      // Nobody wants to fill in litres twice: if they gave dimensions and left
      // the volume blank, take the calculated figure.
      volume: typedVol || Math.round(grossLitres(shape, L, W, H)) || 0,
      shape: shape,
      length_cm: L || null, width_cm: W || null, height_cm: H || null,
      displacement: Math.min(60, Math.max(0, parseInt(document.getElementById('tf-disp').value, 10) || 0)),
      dims: dimsString(shape, L, W, H) || '—',
      started_on: startedOnVal,
      started: startedOnVal ? monthYear(startedOnVal) : (existingStarted || (todayShort() + ' ' + new Date().getFullYear())),
      filter: document.getElementById('tf-filter').value.trim(),
      light: document.getElementById('tf-light').value.trim(),
      substrate: document.getElementById('tf-substrate').value.trim(),
      co2: document.getElementById('tf-co2').value,
      water_source: document.getElementById('tf-water').value,
      notes: document.getElementById('tf-notes').value.trim()
    };
    var saveBtn = document.getElementById('tf-save');
    saveBtn.disabled = true; saveBtn.textContent = 'Saving…';

    var newTags = [data.type]
      .concat(data.filter ? [data.filter] : [])
      .concat(data.light ? [data.light] : [])
      .concat(data.substrate ? [data.substrate] : [])
      .concat(data.co2 ? [data.co2] : [])
      .concat(data.water_source ? [data.water_source] : []);
    var dbFields = {
      name: data.name, type: data.type, volume: data.volume, dims: data.dims,
      started: data.started, started_on: data.started_on, notes: data.notes,
      shape: data.shape, length_cm: data.length_cm, width_cm: data.width_cm, height_cm: data.height_cm,
      displacement: data.displacement, substrate: data.substrate, co2: data.co2, water_source: data.water_source,
      filter: data.filter, light: data.light
    };

    if (editingIdx >= 0){
      var t = tanks[editingIdx];
      if (sb && t.id){
        var res = await dbUpdateRow('tanks', t.id, dbFields);
        if (res.error){ saveBtn.disabled = false; saveBtn.textContent = 'Save aquarium'; popToast('Could not save — try again'); tfSaving = false; return; }
        // simplest correct tag sync: wipe and reinsert
        await sb.from('tank_tags').delete().eq('tank_id', t.id);
        for (var ti = 0; ti < newTags.length; ti++){ await sb.from('tank_tags').insert({ tank_id: t.id, label: newTags[ti] }); }
      }
      Object.assign(t, data);
      t.tags = newTags;
      saveBtn.disabled = false; saveBtn.textContent = 'Save aquarium';
      popToast(t.name + ' updated');
      if (currentTank === editingIdx) renderDetail();
    } else {
      var nt = Object.assign({ subtitle:'', tags:newTags, archived:false,
        params: starterParams(data.type).map(function(k){ return ['', k]; }),
        livestock:[], plants:[], awards:[], photos:[], cover_photo_id:null,
        log:[['Tank set up', 'Welcome to the fishroom', todayShort()]] }, data);

      if (sb && window.currentMember){
        var res2 = await dbInsertRow('tanks', Object.assign({ owner_id: window.currentMember.id }, dbFields));
        saveBtn.disabled = false; saveBtn.textContent = 'Save aquarium';
        if (res2.error){ popToast('Could not save — try again'); tfSaving = false; return; }
        nt.id = res2.data.id;
        // default tags
        for (var tj = 0; tj < newTags.length; tj++){ await sb.from('tank_tags').insert({ tank_id: nt.id, label: newTags[tj] }); }
        // default params
        var defaultParams = starterParams(data.type);
        nt.params = [];
        for (var pi = 0; pi < defaultParams.length; pi++){
          var pr = await dbInsertRow('tank_params', { tank_id: nt.id, label: defaultParams[pi], value: '', sort_order: pi });
          if (!pr.error && pr.data){ var pa = [pr.data.value, pr.data.label]; pa._id = pr.data.id; nt.params.push(pa); }
        }
        // welcome log entry
        var lr = await dbInsertRow('tank_log', { tank_id: nt.id, entry: 'Tank set up', note: 'Welcome to the fishroom' });
        if (!lr.error && lr.data){ var la2 = [lr.data.entry, lr.data.note || '', fmtLogDate(lr.data.logged_at)]; la2._id = lr.data.id; nt.log = [la2]; }
      } else {
        saveBtn.disabled = false; saveBtn.textContent = 'Save aquarium';
      }
      tanks.push(nt);
      popToast(nt.name + ' added to your aquariums');
    }
    closeTankModal();
    renderTanks();
    if (editingIdx < 0){ openTank(tanks.length - 1); }
    if (window.checkBadgeChanges) window.checkBadgeChanges();
    tfSaving = false;
  });

  // ===== locked modals =====
  // Data-entry modals are only dismissed on purpose: close, save or cancel.
  // No backdrop taps, no Escape, and one back press is swallowed rather than
  // throwing someone out of the portal halfway through filling in a tank.
  var lockedModals = [];
  var guardArmed = false, guardConsuming = false;
  function armGuard(){
    if (guardArmed) return;
    try { history.pushState({ ecaacModalGuard: true }, ''); guardArmed = true; } catch (e){}
  }
  function disarmGuard(){
    if (!guardArmed) return;
    guardArmed = false;
    // Pop our own entry back off so a later back press doesn't waste a tap on
    // a history slot the member never navigated to.
    if (history.state && history.state.ecaacModalGuard){
      guardConsuming = true;
      try { history.back(); } catch (e){ guardConsuming = false; }
    }
  }
  window.addEventListener('popstate', function(){
    if (guardConsuming){ guardConsuming = false; return; }
    if (lockedModals.length){ guardArmed = false; armGuard(); }
  });
  function openLocked(el){
    el.classList.add('show');
    if (lockedModals.indexOf(el) === -1) lockedModals.push(el);
    document.body.classList.add('modal-open');
    armGuard();
  }
  function closeLocked(el){
    el.classList.remove('show');
    var i = lockedModals.indexOf(el);
    if (i >= 0) lockedModals.splice(i, 1);
    if (!lockedModals.length){
      document.body.classList.remove('modal-open');
      disarmGuard();
    }
  }

  // ===== quick actions =====
  // A test session is one sitting with the kit, not eight separate taps on
  // eight tiles, so this collects the lot and writes a single log entry.
  var testModal = document.getElementById('test-modal');
  function openTestModal(){
    var t = tanks[currentTank];
    var wrap = document.getElementById('test-fields');
    wrap.innerHTML = t.params.map(function(p, i){
      var def = paramDef(p[1]);
      var range = paramRange(p[1], t.type);
      var hint = range
        ? (def && def.critical ? 'Should read 0' : 'Target ' + range[0] + '–' + range[1] + (def && def.unit ? ' ' + def.unit : ''))
        : '';
      return '<div class="test-row"><label for="ti-' + i + '">' + escT(paramTitle(p[1])) + '</label>' +
        '<div class="ti-wrap"><input id="ti-' + i + '" data-p="' + i + '" inputmode="decimal" placeholder="' +
        (isUntested(p[0]) ? '—' : escT(p[0])) + '">' +
        '<span class="ti-unit">' + escT(def ? def.unit : '') + '</span></div>' +
        (hint ? '<span class="ti-hint">' + escT(hint) + '</span>' : '') + '</div>';
    }).join('');
    if (!t.params.length){
      wrap.innerHTML = '<div class="reg-empty" style="grid-column:1/-1;padding:20px">No parameters on this tank yet — add one below the tiles first.</div>';
    }
    openLocked(testModal);
    var first = wrap.querySelector('input');
    softFocus(first, testModal);
  }
  function closeTestModal(){ closeLocked(testModal); }
  document.getElementById('qa-test').addEventListener('click', openTestModal);
  document.getElementById('test-modal-close').addEventListener('click', closeTestModal);
  document.getElementById('test-cancel').addEventListener('click', closeTestModal);

  var testSaving = false;
  document.getElementById('test-save').addEventListener('click', async function(){
    if (testSaving) return;
    var t = tanks[currentTank];
    var changes = [];
    document.querySelectorAll('#test-fields input').forEach(function(inp){
      var v = inp.value.trim();
      if (!v) return;                       // blank means "didn't test it", not "clear it"
      var i = parseInt(inp.getAttribute('data-p'), 10);
      if (v === t.params[i][0]) return;
      changes.push({ i: i, v: v });
    });
    if (!changes.length){ closeTestModal(); popToast('Nothing to save'); return; }
    testSaving = true;
    var btn = this;
    btn.disabled = true; btn.textContent = 'Saving…';
    var summary = changes.map(function(c){ return paramTitle(t.params[c.i][1]) + ' ' + c.v; }).join(', ');
    if (sb && t.id){
      for (var c = 0; c < changes.length; c++){
        var p = t.params[changes[c].i];
        if (p._id){
          var res = await dbUpdateRow('tank_params', p._id, { value: changes[c].v });
          if (res.error){ btn.disabled = false; btn.textContent = 'Save readings'; testSaving = false; popToast('Could not save — try again'); return; }
        }
      }
      var lr = await dbInsertRow('tank_log', { tank_id: t.id, entry: 'Water test logged', note: summary });
      if (!lr.error && lr.data){
        var la = [lr.data.entry, lr.data.note || '', fmtLogDate(lr.data.logged_at)]; la._id = lr.data.id;
        t.log.unshift(la);
      }
    } else {
      t.log.unshift(['Water test logged', summary, todayShort()]);
    }
    changes.forEach(function(c){ t.params[c.i][0] = c.v; });
    btn.disabled = false; btn.textContent = 'Save readings';
    testSaving = false;
    closeTestModal();
    popToast(changes.length + ' reading' + (changes.length === 1 ? '' : 's') + ' logged');
    renderDetail(); renderTanks();
  });

  var wcModal = document.getElementById('wc-modal');
  function wcLitres(){
    var t = tanks[currentTank];
    var base = netLitres(t) || t.volume || 0;
    var pct = parseInt(document.getElementById('wc-pct').value, 10) || 0;
    return base ? Math.round(base * pct / 100) : 0;
  }
  function syncWc(){
    var l = wcLitres();
    document.getElementById('wc-litres').value = l || '';
  }
  document.getElementById('qa-wc').addEventListener('click', function(){
    document.getElementById('wc-pct').value = 30;
    document.getElementById('wc-note').value = '';
    syncWc();
    openLocked(wcModal);
    softFocus(document.getElementById('wc-pct'), wcModal);
  });
  document.getElementById('wc-pct').addEventListener('input', syncWc);
  function closeWc(){ closeLocked(wcModal); }
  document.getElementById('wc-modal-close').addEventListener('click', closeWc);
  document.getElementById('wc-cancel').addEventListener('click', closeWc);

  document.getElementById('wc-save').addEventListener('click', async function(){
    var t = tanks[currentTank];
    var pct = Math.min(100, Math.max(1, parseInt(document.getElementById('wc-pct').value, 10) || 0));
    var litres = wcLitres();
    var note = document.getElementById('wc-note').value.trim();
    var entry = pct + '% water change' + (litres ? ' (' + litres + ' ℓ)' : '');
    var btn = this;
    btn.disabled = true; btn.textContent = 'Saving…';
    if (sb && t.id){
      var lr = await dbInsertRow('tank_log', { tank_id: t.id, entry: entry, note: note || 'Maintenance' });
      btn.disabled = false; btn.textContent = 'Log it';
      if (lr.error){ popToast('Could not save — try again'); return; }
      var la = [lr.data.entry, lr.data.note || '', fmtLogDate(lr.data.logged_at)]; la._id = lr.data.id;
      t.log.unshift(la);
    } else {
      btn.disabled = false; btn.textContent = 'Log it';
      t.log.unshift([entry, note || 'Maintenance', todayShort()]);
    }
    closeWc();
    popToast('Water change logged');
    renderDetail(); renderTanks();
  });

  document.getElementById('qa-live').addEventListener('click', function(){
    var input = document.getElementById('ls-name');
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(function(){ softFocus(input); }, 320);
  });

  // ===== archive / restore =====
  // Deliberately separate from delete: a tank that's been broken down still
  // holds photos, log history and award entries worth keeping.
  var archBtn = document.getElementById('td-arch-btn');
  archBtn.addEventListener('click', async function(){
    var t = tanks[currentTank];
    var next = !t.archived;
    archBtn.disabled = true;
    if (sb && t.id){
      var res = await dbUpdateRow('tanks', t.id, { archived: next });
      if (res.error){ archBtn.disabled = false; popToast('Could not update — try again'); return; }
    }
    t.archived = next;
    archBtn.disabled = false;
    // Restoring should land them back on a grid where the tank is visible.
    if (!next) tankView.showArchived = false;
    popToast(t.name + (next ? ' archived' : ' restored'));
    renderDetail();
    renderTanks();
  });
  function setArchBtn(t){
    var on = !!(t && t.archived);
    archBtn.innerHTML = on
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg> Restore'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px"><rect x="2" y="4" width="20" height="5" rx="1.5"/><path d="M4 9v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9M10 13h4"/></svg> Archive';
    document.getElementById('td-arch-banner').classList.toggle('show', on);
  }

  // ===== duplicate =====
  // Copies the setup, not the life in it: livestock, plants, photos and log
  // history stay with the original.
  var dupBtn = document.getElementById('td-dup-btn');
  dupBtn.addEventListener('click', async function(){
    var t = tanks[currentTank];
    dupBtn.disabled = true; dupBtn.textContent = 'Duplicating…';
    var copyName = t.name + ' (copy)';
    var dbFields = {
      name: copyName, type: t.type, volume: t.volume, dims: t.dims,
      started: todayShort() + ' ' + new Date().getFullYear(), notes: t.notes,
      shape: t.shape || 'rect', length_cm: t.length_cm || null, width_cm: t.width_cm || null,
      height_cm: t.height_cm || null, displacement: (typeof t.displacement === 'number') ? t.displacement : 12,
      substrate: t.substrate || '', co2: t.co2 || '', water_source: t.water_source || '', archived: false
    };
    var nt = Object.assign({}, dbFields, {
      subtitle: '', tags: (t.tags || []).slice(), archived: false,
      params: (t.params || []).map(function(p){ return [p[0], p[1]]; }),
      livestock: [], plants: [], awards: [], photos: [], cover_photo_id: null,
      log: [['Tank set up', 'Duplicated from ' + t.name, todayShort()]]
    });
    if (sb && window.currentMember){
      var res = await dbInsertRow('tanks', Object.assign({ owner_id: window.currentMember.id }, dbFields));
      if (res.error){ dupBtn.disabled = false; setDupBtn(); popToast('Could not duplicate — try again'); return; }
      nt.id = res.data.id;
      for (var i = 0; i < nt.tags.length; i++){ await sb.from('tank_tags').insert({ tank_id: nt.id, label: nt.tags[i] }); }
      var freshParams = [];
      for (var p = 0; p < nt.params.length; p++){
        var pr = await dbInsertRow('tank_params', { tank_id: nt.id, label: nt.params[p][1], value: nt.params[p][0], sort_order: p });
        if (!pr.error && pr.data){ var pa = [pr.data.value, pr.data.label]; pa._id = pr.data.id; freshParams.push(pa); }
      }
      nt.params = freshParams;
      var lr = await dbInsertRow('tank_log', { tank_id: nt.id, entry: 'Tank set up', note: 'Duplicated from ' + t.name });
      if (!lr.error && lr.data){ var la = [lr.data.entry, lr.data.note || '', fmtLogDate(lr.data.logged_at)]; la._id = lr.data.id; nt.log = [la]; }
    }
    dupBtn.disabled = false; setDupBtn();
    tanks.push(nt);
    popToast(copyName + ' created');
    renderTanks();
    openTank(tanks.length - 1);
    if (window.checkBadgeChanges) window.checkBadgeChanges();
  });
  function setDupBtn(){
    dupBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Duplicate';
  }

  // delete tank (two-step confirm in the button itself)
  var deleteArmed = false, deleteTimer;
  var delBtn2 = document.getElementById('td-delete-btn');
  delBtn2.addEventListener('click', async function(){
    if (!deleteArmed){
      deleteArmed = true;
      delBtn2.textContent = 'Tap again to delete';
      clearTimeout(deleteTimer);
      deleteTimer = setTimeout(function(){ deleteArmed = false; resetDelBtn(); }, 3500);
      return;
    }
    clearTimeout(deleteTimer); deleteArmed = false;
    var t = tanks[currentTank];
    if (sb && t.id){
      delBtn2.disabled = true; delBtn2.textContent = 'Deleting…';
      var res = await dbDeleteRow('tanks', t.id);
      delBtn2.disabled = false;
      if (res.error){ resetDelBtn(); popToast('Could not delete — try again'); return; }
    }
    tanks.splice(currentTank, 1);
    resetDelBtn();
    popToast(t.name + ' deleted');
    renderTanks();
    show('tanks');
  });
  function resetDelBtn(){
    delBtn2.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg> Delete';
  }

  // esc closes tank modal too
  // No Escape handler for these three on purpose — a stray key press shouldn't
  // discard a half-filled form. Close, Save and Cancel are the only ways out.

  // ===== Global search (top bar) =====
  var NAV_ICONS = {
    page: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
    tank: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s4-6 12-6 8 6 8 6-2 6-8 6-12-6-12-6Z"/></svg>',
    guide: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></svg>',
    person: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>'
  };
  var NAV_PAGES = [
    { label:'Dashboard', view:'dashboard', cat:'Page' },
    { label:'My Profile', view:'profile', cat:'Page' },
    { label:'My Membership', view:'membership', cat:'Page' },
    { label:'My Aquariums', view:'tanks', cat:'Page' },
    { label:'Awards Program', view:'awards', cat:'Page' },
    { label:'My Auctions', view:'auctions', cat:'Page' },
    { label:'My Badges', view:'badges', cat:'Page' },
    { label:'Members', view:'members', cat:'Page' },
    { label:'Member Aquariums', view:'member-aquariums', cat:'Page' },
    { label:'Breeders Register', view:'breeders', cat:'Page' },
    { label:'Club Resources', view:'resources', cat:'Page' },
    { label:'Documents', view:'documents', cat:'Page' },
    { label:'Events', view:'events', cat:'Page' },
    { label:'Notifications', view:'notifications', cat:'Page' },
    { label:'Settings', view:'settings', cat:'Page' }
  ];
  var DOC_TITLES = [
    'Meeting minutes — July 2026', 'Club constitution', 'Award program rules — 2026 edition',
    'Certificate — AAP 2nd place, Spring 2026', 'Newsletter — Winter 2026', 'Expo 2027 volunteer pack'
  ];

  function buildSearchIndex(){
    var idx = NAV_PAGES.map(function(p){
      return { label:p.label, sub:'Go to page', icon:'page', action:function(){ show(p.view); } };
    });
    tanks.forEach(function(t, i){
      idx.push({ label:t.name, sub:'Aquarium · ' + t.type, icon:'tank', action:function(){ openTank(i); } });
    });
    GUIDE_SECTIONS.forEach(function(sec){
      sec.guides.forEach(function(g){
        idx.push({ label:g.title, sub:'Guide · ' + g.pill, icon:'guide', action:function(){
          show('resources');
          var input = document.getElementById('res-search');
          if (input){ input.value = g.title; renderGuides(g.title); }
        }});
      });
    });
    DOC_TITLES.forEach(function(d){
      idx.push({ label:d, sub:'Document', icon:'doc', action:function(){ show('documents'); } });
    });
    DIR.forEach(function(m){
      idx.push({ label:m.name, sub:m.committee ? 'Committee · ' + m.role : 'Member', icon:'person', action:function(){
        show('members');
        var input = document.getElementById('dir-search');
        if (input){ input.value = m.name; renderDir(); }
      }});
    });
    return idx;
  }

  var gsInput = document.getElementById('global-search');
  var gsResults = document.getElementById('gsearch-results');
  var gsIndex = null, gsActive = -1, gsCurrent = [];

  function gsRender(items){
    gsCurrent = items; gsActive = items.length ? 0 : -1;
    if (!items.length){
      gsResults.innerHTML = '<div class="gsearch-empty">No matches — try another word</div>';
      gsResults.classList.add('show');
      return;
    }
    gsResults.innerHTML = items.map(function(it, i){
      return '<div class="gsearch-item' + (i===0?' active':'') + '" data-i="' + i + '" role="option">' +
        '<div class="gsearch-icon">' + NAV_ICONS[it.icon] + '</div>' +
        '<div class="gsearch-text"><b>' + escT(it.label) + '</b><span>' + escT(it.sub) + '</span></div></div>';
    }).join('');
    gsResults.classList.add('show');
    gsResults.querySelectorAll('.gsearch-item').forEach(function(el){
      el.addEventListener('mouseenter', function(){ gsSetActive(parseInt(el.getAttribute('data-i'),10)); });
      el.addEventListener('click', function(){ gsSelect(parseInt(el.getAttribute('data-i'),10)); });
    });
  }
  function gsSetActive(i){
    gsActive = i;
    gsResults.querySelectorAll('.gsearch-item').forEach(function(el, idx){ el.classList.toggle('active', idx === i); });
  }
  function gsSelect(i){
    var item = gsCurrent[i];
    if (!item) return;
    item.action();
    gsInput.value = '';
    gsResults.classList.remove('show');
    gsInput.blur();
  }
  function gsClose(){ gsResults.classList.remove('show'); }

  if (gsInput){
    gsInput.addEventListener('focus', function(){
      if (!gsIndex) gsIndex = buildSearchIndex();
      if (gsInput.value.trim()) gsInput.dispatchEvent(new Event('input'));
    });
    gsInput.addEventListener('input', function(){
      if (!gsIndex) gsIndex = buildSearchIndex();
      var q = gsInput.value.toLowerCase().trim();
      if (!q){ gsClose(); return; }
      var matches = gsIndex.filter(function(it){ return it.label.toLowerCase().indexOf(q) !== -1; }).slice(0, 8);
      gsRender(matches);
    });
    gsInput.addEventListener('keydown', function(e){
      if (!gsResults.classList.contains('show')) return;
      if (e.key === 'ArrowDown'){ e.preventDefault(); gsSetActive(Math.min(gsActive + 1, gsCurrent.length - 1)); }
      else if (e.key === 'ArrowUp'){ e.preventDefault(); gsSetActive(Math.max(gsActive - 1, 0)); }
      else if (e.key === 'Enter'){ e.preventDefault(); gsSelect(gsActive >= 0 ? gsActive : 0); }
      else if (e.key === 'Escape'){ gsClose(); gsInput.blur(); }
    });
    document.addEventListener('click', function(e){
      if (!e.target.closest('.top-search')) gsClose();
    });
  }

  // ===== Badges & Tiers =====
  var TIER_NAMES = ['Bronze', 'Silver', 'Gold', 'Platinum'];
  var TIER_CLASS = ['tier-bronze', 'tier-silver', 'tier-gold', 'tier-platinum'];
  var TIER_ICONS = {
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
    gavel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m14.5 12.5-8 8a2.119 2.119 0 1 1-3-3l8-8"/><path d="m16 16 6-6"/><path d="m8 8 6-6"/><path d="m9 7 8 8"/><path d="m21 11-8-8"/></svg>',
    trophy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4Z"/><path d="M7 6H4a3 3 0 0 0 3 5M17 6h3a3 3 0 0 1-3 5"/></svg>',
    fish: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s4-6 12-6 8 6 8 6-2 6-8 6-12-6-12-6Z"/><circle cx="17" cy="10.5" r=".6" fill="currentColor" stroke="none"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2 15 8 22 9 17 14 18 21 12 17.5 6 21 7 14 2 9 9 8 12 2Z"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'
  };

  // Single source of truth for badge tier thresholds. Both the badges page (for the
  // signed-in member) and the directory drawer (for any member) build from this, so
  // the two can never disagree about what earns a tier.
  function badgeCatsFrom(stats){
    return [
      { id:'meetings', label:'Meeting Attendance', icon:'calendar', unit:'meetings attended', unit1:'meeting attended', value:stats.meetings,
        noun:'meetings', noun1:'meeting', tiers:[12, 24, 36, 48] },
      { id:'auctions', label:'Auction Trading', icon:'gavel', unit:'traded at auctions', value:stats.auctionValue, isMoney:true,
        noun:'in auction trade', tiers:[500, 1500, 2500, 5000] },
      { id:'awards', label:'Award Program Points', icon:'trophy', unit:'points earned', unit1:'point earned', value:stats.awardPoints,
        noun:'points', noun1:'point', tiers:[50, 100, 200, 400] },
      { id:'aquariums', label:'Aquarium Collection', icon:'fish', unit:'active aquariums', unit1:'active aquarium', value:stats.tankCount,
        noun:'aquariums', noun1:'aquarium', tiers:[1, 5, 10, 15] },
      { id:'tenure', label:'Membership Tenure', icon:'star', unit:'years as a member', unit1:'year as a member', value:stats.tenureYears,
        noun:'years', noun1:'year', tiers:[1, 3, 5, 10] }
    ];
  }

  // Calendar-year subtraction gave someone who joined on 20 December a full
  // "1 year as a member" — and a Bronze tenure badge — twelve days later. Count
  // elapsed time instead. 365.25 absorbs leap years; an unparseable or future
  // join date reads as 0 rather than something negative.
  function tenureYearsFrom(joinDate){
    if (!joinDate) return 0;
    var t = new Date(joinDate).getTime();
    if (!isFinite(t)) return 0;
    var years = (Date.now() - t) / (365.25 * 24 * 60 * 60 * 1000);
    return years > 0 ? Math.floor(years) : 0;
  }

  function getBadgeCategories(){
    var auctionValue = AUCTIONS.reduce(function(sum, a){ return sum + a.amount; }, 0);
    var stats = window.currentMember
      ? {
          meetings: window.myTotalMeetingsAttended || 0,
          awardPoints: myApprovedPoints,
          tenureYears: tenureYearsFrom(window.currentMember.join_date)
        }
      : { meetings: 71, awardPoints: 245, tenureYears: 8 };
    return badgeCatsFrom({
      meetings: stats.meetings,
      auctionValue: auctionValue,
      awardPoints: stats.awardPoints,
      // "active aquariums" has to mean the same thing here as it does on the
      // dashboard, which filters archived tanks out. Counting them made archiving
      // a tank leave the Aquarium Collection tier untouched.
      tankCount: tanks.filter(function(t){ return !t.archived; }).length,
      tenureYears: stats.tenureYears
    });
  }

  function tierProgress(cat){
    var achieved = 0;
    cat.tiers.forEach(function(t){ if (cat.value >= t) achieved++; });
    var nextIdx = achieved; // index of the next unearned tier
    var maxed = nextIdx >= cat.tiers.length;
    var nextThreshold = maxed ? null : cat.tiers[nextIdx];
    // How far through the *current* stretch this member is, 0–1. Only used to
    // rank categories against each other for the "next badge" card: the raw
    // remainders can't be compared, since 400 rands of trading and 3 meetings
    // are different quantities entirely.
    var prevThreshold = achieved > 0 ? cat.tiers[achieved - 1] : 0;
    var span = maxed ? 0 : (nextThreshold - prevThreshold);
    var stretchFrac = (maxed || span <= 0) ? 1 : Math.max(0, Math.min(1, (cat.value - prevThreshold) / span));
    // Progress toward the final (Platinum) threshold, not just the current
    // stretch. Nothing on screen says "progress within this tier", so a
    // stretch-relative bar reads as wrong — and it resets to near-zero each time
    // you cross a tier. 6 of 10 years now shows 60%, as anyone would expect.
    var finalThreshold = cat.tiers[cat.tiers.length - 1];
    var pct = finalThreshold > 0 ? Math.round((cat.value / finalThreshold) * 100) : 0;
    return { achieved: achieved, maxed: maxed, nextThreshold: nextThreshold, stretchFrac: stretchFrac,
             pct: Math.max(0, Math.min(100, pct)) };
  }

  // Thresholds and remainders are almost always whole rands, so trailing cents
  // are noise. Cents still show when an amount actually has them.
  function fmtVal(v, isMoney){ return isMoney ? money2(v).replace(/\.00$/, '') : v; }

  // Singular/plural for the count noun in each category's unit string.
  // Money categories have no count noun to inflect, so they omit unit1 and
  // fall back to the one form.
  function unitFor(cat, n){ return (n === 1 && cat.unit1) ? cat.unit1 : cat.unit; }

  // Short noun for a "still to go" phrase — "3 meetings", not "3 meetings
  // attended". Money categories have nothing to inflect.
  function nounFor(cat, n){ return (n === 1 && cat.noun1) ? cat.noun1 : (cat.noun || cat.unit); }

  function renderBadgeCategories(){
    var cats = getBadgeCategories();
    var wrap = document.getElementById('badge-categories');
    var totalEarned = 0;
    var nearest = null;   // { away, cat, tierIdx } — the badge this member is closest to
    var highestTierIdx = -1;

    wrap.innerHTML = cats.map(function(cat){
      var prog = tierProgress(cat);
      totalEarned += prog.achieved;
      if (prog.achieved - 1 > highestTierIdx) highestTierIdx = prog.achieved - 1;
      // "Closest" means furthest through its current stretch, not the smallest
      // number: comparing rands to meetings picked whichever category happened to
      // use small units, and the card then printed a bare figure with no way to
      // tell which one it meant.
      if (!prog.maxed && (nearest === null || prog.stretchFrac > nearest.frac)){
        nearest = { away: prog.nextThreshold - cat.value, frac: prog.stretchFrac, cat: cat, tierIdx: prog.achieved };
      }

      var ladder = cat.tiers.map(function(t, i){
        var earned = cat.value >= t;
        var isNext = !earned && i === prog.achieved;
        return '<div class="tier-pip' + (earned ? ' earned' : '') + (isNext ? ' next' : '') + '">' +
          '<div class="dot' + (earned ? ' ' + TIER_CLASS[i] : '') + '">' + (earned ? TIER_ICONS.check : TIER_ICONS.lock) + '</div>' +
          '<b>' + TIER_NAMES[i] + '</b><span>' + fmtVal(t, cat.isMoney) + '</span></div>';
      }).join('');

      var nextLine = prog.maxed
        ? '<div class="badge-cat-next">🏆 <b>Platinum reached</b> — top tier in this category.</div>'
        : '<div class="badge-cat-next"><b>' + fmtVal(prog.nextThreshold - cat.value, cat.isMoney) + '</b> more ' + unitFor(cat, prog.nextThreshold - cat.value) + ' to reach <b>' + TIER_NAMES[prog.achieved] + '</b>.</div>';

      return '<div class="badge-cat">' +
        '<div class="badge-cat-head">' +
          '<div class="badge-cat-icon ' + (prog.achieved ? TIER_CLASS[prog.achieved - 1] : '') + '" style="' + (prog.achieved ? '' : 'background:linear-gradient(135deg,var(--deep),var(--deep-2))') + '">' + TIER_ICONS[cat.icon] + '</div>' +
          '<div class="badge-cat-title"><h4>' + cat.label + '</h4><span>' + fmtVal(cat.value, cat.isMoney) + ' ' + unitFor(cat, cat.value) + '</span></div>' +
          '<div class="badge-cat-current"><b>' + (prog.achieved ? TIER_NAMES[prog.achieved - 1] : 'Unranked') + '</b><span>Current tier</span></div>' +
        '</div>' +
        '<div class="progress"><i style="width:' + prog.pct + '%;' + (prog.achieved ? 'background:linear-gradient(90deg,var(--leaf),var(--leaf-dark))' : '') + '"></i></div>' +
        nextLine +
        '<div class="tier-ladder">' + ladder + '</div>' +
      '</div>';
    }).join('');

    document.getElementById('badges-earned-count').textContent = totalEarned;
    // The Awards page "Badges earned" card was zeroed at login and never updated.
    // Live only — demo keeps its authored figure.
    if (sb && window.currentMember){
      document.querySelectorAll('[data-live="aw-badges"]').forEach(function(el){ el.textContent = totalEarned; });
    }
    document.getElementById('badges-standing').textContent = highestTierIdx >= 0 ? TIER_NAMES[highestTierIdx] : 'Unranked';

    var awayEl = document.getElementById('badges-next-away');
    var awayLabelEl = document.getElementById('badges-next-label');
    if (nearest === null){
      awayEl.textContent = 'All maxed!';
      if (awayLabelEl) awayLabelEl.textContent = 'Every tier in every category earned';
    } else {
      awayEl.textContent = fmtVal(nearest.away, nearest.cat.isMoney);
      if (awayLabelEl){
        awayLabelEl.textContent = nounFor(nearest.cat, nearest.away) + ' to ' +
          TIER_NAMES[nearest.tierIdx] + ' \u00B7 ' + nearest.cat.label;
      }
    }

    // showcase grid: every tier of every category, earned or locked
    var showcase = document.getElementById('badges-showcase');
    var tiles = [];
    cats.forEach(function(cat){
      var prog = tierProgress(cat);
      cat.tiers.forEach(function(t, i){
        var earned = cat.value >= t;
        tiles.push('<div class="aw-badge' + (earned ? '' : ' locked') + '">' +
          '<div class="ring' + (earned ? '' : '') + '" style="' + (earned ? 'background:var(--tier-bg-' + i + ')' : '') + '">' + TIER_ICONS[cat.icon] + '</div>' +
          '<span>' + TIER_NAMES[i] + ' ' + cat.label + '</span></div>');
      });
    });
    // inline tier gradients (ring bg can't use the .tier-* classes directly since .ring already sets background)
    var tierGrads = ['linear-gradient(135deg,#C98A4B,#8B5A2B)','linear-gradient(135deg,#C7CEDC,#8892A6)','linear-gradient(135deg,var(--gold),var(--gold-dark))','linear-gradient(135deg,#8FE3E8,#2E7D8C)'];
    showcase.innerHTML = tiles.join('').replace(/var\(--tier-bg-(\d)\)/g, function(_, i){ return tierGrads[+i]; });

    renderMilestoneBadges();
    if (typeof renderAwardBadgeStrip === 'function') renderAwardBadgeStrip();
  }

  // ===== One-time milestone badges (novelty, always green when earned) =====
  var MILESTONE_ICONS = {
    spawn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s4-6 12-6 8 6 8 6-2 6-8 6-12-6-12-6Z"/><circle cx="17" cy="10.5" r=".6" fill="currentColor" stroke="none"/></svg>',
    bloom: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21V9"/><path d="M12 12c0-4 3-7 7-7 0 4-3 7-7 7Z"/><path d="M12 15c0-4-3-6-7-6 0 4 3 6 7 6Z"/></svg>',
    scape: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 17l5-6 4 4 5-7 4 5"/><path d="M3 20h18"/></svg>',
    tank: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="18" height="13" rx="1.5"/><path d="M3 11h18M12 3v3"/></svg>',
    gavel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m14.5 12.5-8 8a2.119 2.119 0 1 1-3-3l8-8"/><path d="m16 16 6-6"/><path d="m8 8 6-6"/><path d="m9 7 8 8"/><path d="m21 11-8-8"/></svg>',
    portal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg>',
    card: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20"/></svg>',
    profile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>',
    gavel2: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4Z"/><path d="M7 6H4a3 3 0 0 0 3 5M17 6h3a3 3 0 0 1-3 5"/></svg>',
    seedling: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2 15 8 22 9 17 14 18 21 12 17.5 6 21 7 14 2 9 9 8 12 2Z"/></svg>',
    droplet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2.7 6.6 9.3a7.2 7.2 0 1 0 10.8 0Z"/></svg>',
    notebook: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 3h14v18H5Z"/><path d="M9 3v18M12 8h4M12 12h4"/></svg>',
    stock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 13s3.5-5 10-5 7 5 7 5-1.5 5-7 5-10-5-10-5Z"/><circle cx="15" cy="12" r=".6" fill="currentColor" stroke="none"/><path d="M19 3v4M17 5h4"/></svg>',
    leaf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 20A7 7 0 0 1 4 13c0-6 8-10 16-10 0 8-4 17-9 17Z"/><path d="M4 21c2-6 6-9 10-11"/></svg>',
    camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><circle cx="12" cy="13" r="3.4"/></svg>',
    people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="3.2"/><path d="M2.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5"/><path d="M16 5.6a3.2 3.2 0 0 1 0 5.6"/><path d="M18.2 13.9c2 .8 3.3 2.8 3.3 5.1"/></svg>',
    crown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 19h16"/><path d="M3 7l4.5 3.5L12 4l4.5 6.5L21 7l-1.8 9H4.8Z"/></svg>',
    rosette: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="9" r="6"/><path d="M9.6 9.2l1.8 1.8 3.2-3.4"/><path d="M8.6 14.4 7 22l5-2.6L17 22l-1.6-7.6"/></svg>',
    cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2.5 4h2.2l2.3 10.6a2 2 0 0 0 2 1.6h7.4a2 2 0 0 0 2-1.6L20.5 8H6"/><circle cx="10" cy="20" r="1.3"/><circle cx="17" cy="20" r="1.3"/></svg>',
    note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M5.5 12h.01M18.5 12h.01"/></svg>',
    sparkle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M9 2.5l1.6 4.9 4.9 1.6-4.9 1.6L9 15.5l-1.6-4.9L2.5 9l4.9-1.6Z"/><path d="M17.5 13l.9 2.8 2.8.9-2.8.9-.9 2.8-.9-2.8-2.8-.9 2.8-.9Z"/></svg>',
    layers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 2 2 7l10 5 10-5Z"/><path d="M2 12l10 5 10-5"/><path d="M2 17l10 5 10-5"/></svg>',
    nano: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="7" y="3" width="10" height="18" rx="2"/><path d="M7 8h3M7 12h3M7 16h3"/></svg>',
    whale: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2.5 10c0 6 4.2 9.5 9.5 9.5s9.5-3.5 9.5-9.5"/><path d="M2.5 10s3-2.2 6.2 0"/><path d="M17.5 4.5c1.4 1 2 2.6 2 4.2"/><circle cx="8" cy="12.6" r=".7" fill="currentColor" stroke="none"/></svg>',
    waves: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 7.5c2.4-2 4.8-2 7.2 0s4.8 2 7.2 0 2.4-1.4 5.6-1.4"/><path d="M2 13c2.4-2 4.8-2 7.2 0s4.8 2 7.2 0"/><path d="M2 18.5c2.4-2 4.8-2 7.2 0s4.8 2 7.2 0"/></svg>',
    shapes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><circle cx="7" cy="17" r="4"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.4"/><path d="M12 2.5l4.6 8.2H7.4Z"/></svg>',
    hourglass: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 2h12M6 22h12"/><path d="M8 2v3.6c0 1.6 1.2 2.6 2.6 3.6L12 11l1.4-1.8C14.8 8.2 16 7.2 16 5.6V2"/><path d="M8 22v-3.6c0-1.6 1.2-2.6 2.6-3.6L12 13l1.4 1.8c1.4 1 2.6 2 2.6 3.6V22"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M20.5 14.8A8.6 8.6 0 1 1 9.2 3.5a6.9 6.9 0 0 0 11.3 11.3Z"/></svg>',
    heart: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 20.7 4.6 13.4a4.6 4.6 0 0 1 6.5-6.5l.9.9.9-.9a4.6 4.6 0 1 1 6.5 6.5Z"/></svg>',
    hearts: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M9.5 19.5 3.6 13.6a3.9 3.9 0 0 1 5.5-5.5l.4.4.4-.4a3.9 3.9 0 0 1 5.5 5.5Z"/><path d="M16.5 4.2a3.2 3.2 0 0 1 4 4.6l-2.6 2.7"/></svg>',
        sunrise: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2.5v3M5.2 8.2 7.3 10.3M2.5 15h2.6M18.9 15h2.6M16.7 10.3l2.1-2.1"/><path d="M8 15a4 4 0 0 1 8 0"/><path d="M2 19.5h20"/></svg>'
  };

  // Tanks are created with placeholder parameters ('—') and an automatic
  // "Tank set up" log entry, and both are written to the database. Counting them
  // naively would hand Water Watcher and Logbook Started over free with the very
  // first tank, so both are filtered out here.
  function realParamCount(t){
    return (t.params || []).filter(function(p){
      var v = String(p && p[0] != null ? p[0] : '').trim();
      return v !== '' && v !== '—' && v !== '-' && v !== '–';
    }).length;
  }
  function realLogCount(t){
    return (t.log || []).filter(function(l){
      return String(l && l[0] ? l[0] : '').trim().toLowerCase() !== 'tank set up';
    }).length;
  }
  // "started" is free text (e.g. "Mar 2021"). Anything unparseable simply doesn't
  // qualify rather than throwing.
  function tankAgeYears(t){
    if (!t.started) return -1;
    var d = new Date(t.started);
    if (isNaN(d.getTime())) return -1;
    return (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
  }

  // Time-of-day badges have to be remembered: earned at 01:00, a live check would
  // switch the badge back off by morning and make it look broken.
  var funBadgeKey = 'ecaac-fun-badges-' + (window.currentMember ? window.currentMember.id : 'demo');
  var funBadges = {};
  try { funBadges = JSON.parse(localStorage.getItem(funBadgeKey) || '{}') || {}; } catch (e){ funBadges = {}; }
  (function stampTimeOfDay(){
    var h = new Date().getHours(), changed = false;
    if (h < 4 && !funBadges.nightOwl){ funBadges.nightOwl = true; changed = true; }             // 00:00–03:59
    if (h >= 4 && h < 6 && !funBadges.earlyBird){ funBadges.earlyBird = true; changed = true; } // 04:00–05:59
    if (changed){ try { localStorage.setItem(funBadgeKey, JSON.stringify(funBadges)); } catch (e){} }
  })();

  // Hearts live further down the file (see "Tank hearts"), and getMilestoneBadges
  // can run before those vars are assigned — badge checks fire as each loader
  // lands, in no fixed order. Reading them defensively here is cheaper than
  // moving a whole feature to satisfy declaration order.
  function heartStats(){
    var counts = (typeof likeCounts === 'undefined' || !likeCounts) ? {} : likeCounts;
    var mine   = (typeof myLikes   === 'undefined' || !myLikes)   ? {} : myLikes;
    var received = 0, best = 0;
    (tanks || []).forEach(function(t){
      var n = (t && t.id && counts[t.id]) ? counts[t.id] : 0;
      received += n;
      if (n > best) best = n;
    });
    return { given: Object.keys(mine).length, received: received, best: best };
  }

  function getMilestoneBadges(){
    var hasBAP = ENTRIES.some(function(e){ return /^BAP/.test(e.title); });
    var hasHAP = ENTRIES.some(function(e){ return /^HAP/.test(e.title); });
    var hasAAP = ENTRIES.some(function(e){ return /^AAP/.test(e.title); });
    var cm = window.currentMember;
    var isLiveUser = !!cm;
    var hasFullProfile = isLiveUser ? !!(cm.first_name && cm.bio) : true;
    var isCommittee = isLiveUser ? cm.role === 'admin' : true;
    var isFoundingYear = isLiveUser ? isFoundingJoinDate(cm.join_date) : true;

    var totalLogs = tanks.reduce(function(a, t){ return a + realLogCount(t); }, 0);
    var totalLivestock = tanks.reduce(function(a, t){ return a + (t.livestock || []).length; }, 0);
    var types = {};
    tanks.forEach(function(t){ if (t.type) types[String(t.type).trim()] = true; });
    var meetingsAttended = isLiveUser ? (window.myTotalMeetingsAttended || 0) : 71;
    // Demo mode has no hearts at all (no database, no signed-in member), so it
    // gets illustrative figures the same way meetings does — otherwise the demo
    // shows four permanently-locked badges nobody can explain.
    var hearts = isLiveUser ? heartStats() : { given: 12, received: 9, best: 6 };
    var roleIs = function(want){
      return AUCTIONS.some(function(a){ return String(a.role || '').toLowerCase() === want; });
    };

    return [
      // --- getting started ---
      { group:'start', label:'Portal Pioneer', icon:'portal', earned: true, hint:'Log in to the members portal' },
      { group:'start', label:'Tank Registered', icon:'tank', earned: tanks.length > 0, hint:'Add your first aquarium' },
      { group:'start', label:'Water Watcher', icon:'droplet', earned: tanks.some(function(t){ return realParamCount(t) > 0; }), hint:'Log your first water parameters' },
      { group:'start', label:'Logbook Started', icon:'notebook', earned: totalLogs > 0, hint:'Write your first maintenance entry' },
      { group:'start', label:'Stocked Up', icon:'stock', earned: totalLivestock > 0, hint:'Add your first livestock' },
      { group:'start', label:'Green Thumb', icon:'leaf', earned: tanks.some(function(t){ return (t.plants || []).length > 0; }), hint:'Add your first plant' },
      { group:'start', label:'Snap Happy', icon:'camera', earned: tanks.some(function(t){ return (t.photos || []).length > 0; }), hint:'Upload your first tank photo' },
      { group:'start', label:'Full Profile', icon:'profile', earned: hasFullProfile, hint:'Complete your member profile' },
      { group:'start', label:'Card Carrier', icon:'card', earned: cardDownloaded, hint:'Download your membership card' },

      // --- club life ---
      { group:'club', label:'Meet the Club', icon:'people', earned: meetingsAttended > 0, hint:'Attend your first club meeting' },
      { group:'club', label:'Going Once', icon:'cart', earned: roleIs('bought'), hint:'Buy your first lot at auction' },
      { group:'club', label:'Sold!', icon:'note', earned: roleIs('sold'), hint:'Sell your first lot at auction' },
      { group:'club', label:'Showing Love', icon:'heart', earned: hearts.given >= 1, hint:'Heart another member\u2019s aquarium' },
      { group:'club', label:'Generous Heart', icon:'hearts', earned: hearts.given >= 10, hint:'Heart ten different aquariums' },

      // --- award programs ---
      { group:'club', label:'First Spawn', icon:'spawn', earned: hasBAP, hint:'Log a BAP entry for a spawn' },
      { group:'club', label:'First Bloom', icon:'bloom', earned: hasHAP, hint:'Log a HAP plant entry' },
      { group:'club', label:'Aquascape Debut', icon:'scape', earned: hasAAP, hint:'Submit an AAP entry' },
      { group:'club', label:'Triple Crown', icon:'crown', earned: hasBAP && hasHAP && hasAAP, hint:'Enter BAP, HAP and AAP at least once' },
      { group:'club', label:'On the Board', icon:'rosette', earned: ENTRIES.some(function(e){ return e.status === 'ok'; }), hint:'Get an award entry approved' },

      // --- depth ---
      { group:'collect', label:'Clean Sweep', icon:'sparkle', earned: totalLogs >= 5, hint:'Log five maintenance entries' },
      { group:'collect', label:'Species Collector', icon:'layers', earned: totalLivestock >= 10, hint:'Log ten livestock entries' },
      { group:'collect', label:'First Heart', icon:'heart', earned: hearts.received >= 1, hint:'Have one of your aquariums hearted' },
      { group:'collect', label:'Well Loved', icon:'hearts', earned: hearts.best >= 5, hint:'Get five hearts on a single aquarium' },

      // --- tank personality ---
      { group:'collect', label:'Nano Nut', icon:'nano', earned: tanks.some(function(t){ var v = Number(t.volume); return v > 0 && v < 30; }), hint:'Register a tank under 30 ℓ' },
      { group:'collect', label:'Leviathan', icon:'whale', earned: tanks.some(function(t){ return Number(t.volume) > 300; }), hint:'Register a tank over 300 ℓ' },
      { group:'collect', label:'Salt Life', icon:'waves', earned: tanks.some(function(t){ return String(t.type || '').toLowerCase() === 'marine'; }), hint:'Register a marine aquarium' },
      { group:'collect', label:'Jack of All Tanks', icon:'shapes', earned: Object.keys(types).length >= 3, hint:'Keep three different tank types' },
      { group:'collect', label:'Old Faithful', icon:'hourglass', earned: tanks.some(function(t){ return tankAgeYears(t) >= 3; }), hint:'Keep a tank running three years' },

      // --- just for fun ---
      { group:'fun', label:'Night Owl', icon:'moon', earned: !!funBadges.nightOwl, hint:'Use the portal after midnight' },
      { group:'fun', label:'Early Bird', icon:'sunrise', earned: !!funBadges.earlyBird, hint:'Use the portal before 6am' },

      // --- recognition ---
      { group:'recognition', label:'Committee Circle', icon:'gavel2', earned: isCommittee, hint:'Join the club committee' },
      { group:'recognition', label:'Founding Member', icon:'seedling', earned: isFoundingYear, hint:'Have joined in ' + CLUB.foundingYear }
    ];
  }

  // Grouping keeps a new member from facing one wall of ~20 grey circles: each
  // section is a short, achievable-looking list with its own progress count.
  // Recognition is status rather than achievement (you can't go back and join in
  // 2018), so it sits apart and is left out of the headline count.
  var MS_GROUPS = [
    { id:'start',       title:'Getting started',   note:'The basics — set up your fishroom in the portal.' },
    { id:'club',        title:'Club life & awards', note:'Show up, trade a lot, and enter the award programs.' },
    { id:'collect',     title:'Building a collection', note:'For the depth and variety of what you keep.' },
    { id:'fun',         title:'Just for fun',      note:'No reason at all.' },
    { id:'recognition', title:'Recognition',       note:'Marks of standing in the club rather than things to chase.', excludeFromCount:true, hideWhenLocked:true }
  ];

  function msBadgeHtml(m){
    return '<div class="aw-badge' + (m.earned ? '' : ' locked') + '">' +
      '<div class="ring" style="' + (m.earned ? 'background:linear-gradient(135deg,var(--leaf),var(--leaf-dark))' : '') + '">' + MILESTONE_ICONS[m.icon] + '</div>' +
      '<span>' + escT(m.label) + '</span>' +
      (m.earned ? '' : '<div class="hint">' + escT(m.hint) + '</div>') +
    '</div>';
  }

  function renderMilestoneBadges(){
    var list = getMilestoneBadges();
    var el = document.getElementById('milestone-badges');
    var countEl = document.getElementById('milestones-count');
    if (!el) return;

    var countable = list.filter(function(m){
      var g = MS_GROUPS.filter(function(x){ return x.id === m.group; })[0];
      return !(g && g.excludeFromCount);
    });
    var earnedCount = countable.filter(function(m){ return m.earned; }).length;
    if (countEl) countEl.textContent = earnedCount + ' of ' + countable.length + ' earned';

    el.innerHTML = MS_GROUPS.map(function(g){
      var items = list.filter(function(m){ return m.group === g.id; });
      // Status badges nobody can act on ("Have joined in 2018") read as failures
      // rather than goals, so unearned ones are hidden and the whole group
      // disappears for members who have none of them.
      if (g.hideWhenLocked) items = items.filter(function(m){ return m.earned; });
      if (!items.length) return '';
      var got = items.filter(function(m){ return m.earned; }).length;
      return '<div class="ms-group">' +
        '<div class="ms-group-head"><h5>' + escT(g.title) + '</h5>' +
          (g.hideWhenLocked ? '' : '<span class="ms-count">' + got + ' / ' + items.length + '</span>') + '</div>' +
        '<p class="ms-group-note">' + escT(g.note) + '</p>' +
        '<div class="milestone-badges">' + items.map(msBadgeHtml).join('') + '</div>' +
      '</div>';
    }).join('');
  }

  // ===== Membership timeline =====
  // Built from what the database actually knows about this member. Previously this
  // was three hardcoded rows describing one person, shown to everyone.
  // Note: there is no column recording when someone joined the committee or was
  // elected to an office, so committee standing is shown without inventing a year.
  var TL_ICONS = {
    trophy: '<path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4Z"/>',
    person: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>',
    fish:   '<path d="M2 12s4-6 12-6 8 6 8 6-2 6-8 6-12-6-12-6Z"/>',
    star:   '<path d="M12 3l2.6 5.6 6.1.8-4.4 4.2 1.1 6-5.4-3-5.4 3 1.1-6L3.3 9.4l6.1-.8L12 3Z"/>',
    seed:   '<path d="M12 21V9M12 9a6 6 0 0 1 6-6 6 6 0 0 1-6 6ZM12 9A6 6 0 0 0 6 3a6 6 0 0 0 6 6Z"/>'
  };

  function renderMemberTimeline(){
    var el = document.getElementById('member-timeline');
    if (!el) return;
    var cm = window.currentMember;
    if (!cm){
      // Demo mode: keep the original illustrative timeline, which used to live in
      // the markup. Live members get their real one below.
      el.innerHTML =
        '<div class="row"><div class="row-icon gold"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' + TL_ICONS.trophy + '</svg></div>' +
          '<div class="row-body"><b>Elected Club President</b><span>Annual general meeting</span></div><div class="row-end">2023</div></div>' +
        '<div class="row"><div class="row-icon deep"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' + TL_ICONS.person + '</svg></div>' +
          '<div class="row-body"><b>Joined the committee</b><span>Events coordinator</span></div><div class="row-end">2020</div></div>' +
        '<div class="row"><div class="row-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' + TL_ICONS.fish + '</svg></div>' +
          '<div class="row-body"><b>Founding-year member</b><span>One of ECAAC\u2019s first members</span></div><div class="row-end">2018</div></div>';
      return;
    }

    var now = new Date();
    var joinYear = cm.join_date ? new Date(String(cm.join_date).slice(0,10) + 'T00:00:00').getFullYear() : null;
    var items = [];

    // Committee standing — real, but undated (no column records when it started).
    if (cm.role === 'admin'){
      items.push({ sort: Infinity, year: 'Current', icon:'person', tone:'deep',
        title:'Committee member', note:'Serving on the ECAAC committee' });
    }

    // Tenure milestones actually reached.
    if (joinYear){
      [25, 20, 15, 10, 5].forEach(function(n){
        if (now.getFullYear() - joinYear >= n){
          items.push({ sort: joinYear + n, year: joinYear + n, icon:'star', tone:'gold',
            title: n + ' years a member', note:'Membership milestone reached' });
        }
      });
    }

    // First approved award entry.
    var approved = (myEntryRows || []).filter(function(r){ return r.status === 'approved' && r.submitted_at; });
    if (approved.length){
      var firstAw = approved.reduce(function(a, r){
        return (!a || new Date(r.submitted_at) < new Date(a.submitted_at)) ? r : a;
      }, null);
      var awYear = new Date(firstAw.submitted_at).getFullYear();
      items.push({ sort: awYear, year: awYear, icon:'trophy', tone:'gold',
        title:'First award entry approved',
        note: firstAw.program + (firstAw.species ? ' \u2014 ' + firstAw.species : '') });
    }

    // First aquarium registered (started is member-entered text, so only use it
    // when it parses to a real date).
    var dated = (tanks || []).filter(function(t){ return t.started && !isNaN(new Date(t.started).getTime()); });
    if (dated.length){
      var firstTank = dated.reduce(function(a, t){
        return (!a || new Date(t.started) < new Date(a.started)) ? t : a;
      }, null);
      var tkYear = new Date(firstTank.started).getFullYear();
      items.push({ sort: tkYear, year: tkYear, icon:'fish', tone:'',
        title:'First aquarium registered', note: firstTank.name });
    }

    // Joined the club — the anchor. Founding status folds in here rather than
    // duplicating the same year on two rows.
    if (joinYear){
      var founding = isFoundingJoinDate(cm.join_date);
      items.push({ sort: joinYear - 0.5, year: joinYear, icon: founding ? 'seed' : 'person',
        tone: founding ? '' : 'deep',
        title: founding ? 'Founding member' : 'Joined ECAAC',
        note: founding ? 'One of the club\u2019s first members' : memberTypeInfo(cm.membership_type).pill });
    }

    if (!items.length){
      el.innerHTML = '<div class="reg-empty" style="padding:22px">Your timeline fills in as your membership grows.</div>';
      return;
    }
    items.sort(function(a, b){ return b.sort - a.sort; });
    el.innerHTML = items.map(function(it){
      return '<div class="row"><div class="row-icon' + (it.tone ? ' ' + it.tone : '') + '">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' + TL_ICONS[it.icon] + '</svg></div>' +
        '<div class="row-body"><b>' + escT(it.title) + '</b><span>' + escT(it.note || '') + '</span></div>' +
        '<div class="row-end">' + escT(String(it.year)) + '</div></div>';
    }).join('');
  }
  window.renderMemberTimeline = renderMemberTimeline;
  renderMemberTimeline();

  // ===== Detect newly-earned badges and raise the notification bar =====
  var TIER_RING_GRADS = ['linear-gradient(135deg,#C98A4B,#8B5A2B)','linear-gradient(135deg,#C7CEDC,#8892A6)','linear-gradient(135deg,var(--gold),var(--gold-dark))','linear-gradient(135deg,#8FE3E8,#2E7D8C)'];

  function currentEarnedBadges(){
    var earned = {}; // key -> {title, icon, ringBg, kicker}
    getBadgeCategories().forEach(function(cat){
      var prog = tierProgress(cat);
      for (var i = 0; i < prog.achieved; i++){
        earned['tier:' + cat.id + ':' + i] = {
          title: TIER_NAMES[i] + ' — ' + cat.label,
          icon: TIER_ICONS[cat.icon],
          ringBg: TIER_RING_GRADS[i],
          kicker: 'Tier reached'
        };
      }
    });
    getMilestoneBadges().forEach(function(m){
      if (m.earned) earned['ms:' + m.label] = {
        title: m.label,
        icon: MILESTONE_ICONS[m.icon],
        ringBg: 'linear-gradient(135deg,var(--leaf),var(--leaf-dark))',
        kicker: 'Badge earned'
      };
    });
    return earned;
  }

  // Which badges this member has already been shown a notification for, persisted
  // across sessions — deliberately NOT an in-memory snapshot. Several data sources
  // (tanks, entries, events, auctions) load in parallel after login in no fixed
  // order; a single "first call becomes the baseline" snapshot could be built from
  // partial data if it ran before everything had loaded, making an already-earned
  // badge look "new" once the rest of the data caught up moments later — which is
  // exactly what caused repeat notifications on every login.
  var seenBadgesKey = 'ecaac-seen-badges-' + (window.currentMember ? window.currentMember.id : 'demo');
  var seenBadges = null;

  function loadSeenBadges(){
    try {
      var raw = localStorage.getItem(seenBadgesKey);
      seenBadges = raw ? JSON.parse(raw) : {};
    } catch (e) { seenBadges = {}; }
  }
  function saveSeenBadges(){
    try { localStorage.setItem(seenBadgesKey, JSON.stringify(seenBadges)); } catch (e) { /* storage unavailable, non-fatal */ }
  }

  // Call after any action that could change badge state. Each badge is checked
  // independently against the persisted seen-set, so partial/out-of-order data
  // loading can never cause a false "new" badge — and once shown, a badge is
  // marked seen immediately, so it can never notify twice, this session or any
  // future one.
  // Bump whenever badges are added to or removed from the catalogue.
  var BADGE_CATALOGUE_VERSION = 3;

  function checkBadgeChanges(){
    if (seenBadges === null) loadSeenBadges();
    var now = currentEarnedBadges();
    var firstEverCheck = Object.keys(seenBadges).length === 0 && !seenBadges.__seeded;
    if (firstEverCheck){
      // first time this member's badges have ever been checked on this device —
      // seed the seen-set silently so we don't announce their entire existing
      // badge history the moment this feature reaches them.
      Object.keys(now).forEach(function(key){ seenBadges[key] = true; });
      seenBadges.__seeded = true;
      seenBadges.__catalogue = BADGE_CATALOGUE_VERSION;
      saveSeenBadges();
      return;
    }
    // A release that adds new badge types would otherwise fire a popup for every
    // one the member already qualifies for — a dozen at once on first load.
    // Absorb the new catalogue silently, once; genuine future earns still notify.
    if (seenBadges.__catalogue !== BADGE_CATALOGUE_VERSION){
      Object.keys(now).forEach(function(key){ seenBadges[key] = true; });
      seenBadges.__catalogue = BADGE_CATALOGUE_VERSION;
      saveSeenBadges();
      return;
    }
    var changed = false;
    Object.keys(now).forEach(function(key){
      if (!seenBadges[key]){
        notifyBadge(now[key]);
        seenBadges[key] = true;
        changed = true;
      }
    });
    if (changed) saveSeenBadges();
  }
  // Debounced: several data sources (tanks, entries, events, auctions) each call
  // this independently as they finish loading, in no guaranteed order. Debouncing
  // collapses those into a single real check after a short quiet period once
  // everything's settled, so the very first check of a session sees the complete
  // picture — not whichever loader happened to finish first.
  var checkBadgeChangesTimer = null;
  window.checkBadgeChanges = function(){
    clearTimeout(checkBadgeChangesTimer);
    checkBadgeChangesTimer = setTimeout(function(){
      checkBadgeChanges();
      // Same settle point used to decide "did anything new get earned" is also
      // the right moment to refresh what's on screen — so the badge strip (now
      // shown on both the Dashboard and the Awards page) never has to wait for
      // a view navigation to stop showing stale/placeholder badges.
      if (typeof renderAwardBadgeStrip === 'function') renderAwardBadgeStrip();
      // The Badges page itself only ever rendered from show(). A #/badges deep
      // link is applied before entries, tanks, events and auctions have landed,
      // so it painted every category at zero and stayed that way until the member
      // navigated away and back — a bug that looked intermittent because any
      // other route reached the page after the loaders had finished. Repaint it
      // here too, but only while it's the visible view.
      var badgeView = document.getElementById('view-badges');
      if (badgeView && badgeView.classList.contains('active') && typeof renderBadgeCategories === 'function'){
        renderBadgeCategories();
      }
    }, 500);
  };

  // ===== Member Aquariums (club-wide directory) =====
  var MA_AVATAR_GRADS = ['linear-gradient(135deg,var(--deep),var(--leaf))','linear-gradient(135deg,var(--leaf),var(--leaf-dark))','linear-gradient(135deg,var(--deep-2),var(--deep))','linear-gradient(135deg,var(--leaf-dark),var(--deep))','linear-gradient(135deg,var(--deep),var(--deep-3))','linear-gradient(135deg,var(--coral),var(--coral-dark))'];
  function maInitials(n){ return n.split(/\s+/).map(function(w){return w[0];}).slice(0,2).join('').toUpperCase(); }

  // Other members' tanks are loaded live from Supabase (see loadOtherMemberTanks below).
  // No demo data here — if nobody else has added a tank yet, this list is genuinely empty.
  var otherMemberTanks = [];

  async function loadOtherMemberTanks(){
    if (!sb || !window.currentMember) { otherMemberTanks = []; return; }
    var res = await sb.from('tanks')
      .select('*, tank_tags(*), tank_params(*), tank_livestock(*), tank_plants(*), tank_photos!tank_id(*), members(first_name,last_name)')
      .neq('owner_id', window.currentMember.id)
      .order('created_at', { ascending: true });
    if (res.error || !res.data){ otherMemberTanks = []; renderMemberAquariums(); return; }
    otherMemberTanks = res.data.map(function(row){
      var ownerName = row.members ? ((row.members.first_name || '') + ' ' + (row.members.last_name || '')).trim() : '';
      var params = (row.tank_params || []).slice().sort(function(a,b){ return (a.sort_order||0) - (b.sort_order||0); })
        .map(function(p){ return [p.value, p.label]; });
      var photos = (row.tank_photos || []).map(function(p){ return { id: p.id, url: p.url, path: p.path }; });
      return {
        // The tank's own id was never carried across here — the mapping kept
        // owner_id but dropped the primary key, so nothing downstream could
        // address an individual tank. Hearts need it. Same trap as ownerId:
        // if this mapping is ever refactored, both must survive.
        id: row.id,
        name: row.name, type: row.type, subtitle: row.subtitle || '',
        volume: row.volume || 0, dims: row.dims || '—', started: row.started || '',
        owner: ownerName || 'ECAAC member',
        ownerId: row.owner_id,
        tags: (row.tank_tags || []).map(function(t){ return t.label; }),
        params: params,
        livestock: (row.tank_livestock || []).map(function(l){ return [l.name, l.note || '', l.qty || '']; }),
        plants: (row.tank_plants || []).map(function(p){ return [p.name, p.note || '', p.qty || '']; }),
        photos: photos, cover_photo_id: row.cover_photo_id || null,
        mine: false
      };
    });
    renderMemberAquariums();
  }

  function getAllMemberTanks(){
    var mine = tanks.map(function(t, i){
      return Object.assign({}, t, { owner: member.name, mine:true, myIndex:i });
    });
    return mine.concat(otherMemberTanks);
  }

  // ===== Tank hearts =====
  //
  // A quiet bit of appreciation: any member can heart another member's
  // aquarium, and every tank shows its running total. Deliberately small —
  // this is a nod, not a scoreboard, so there's no ranking, no "most loved"
  // list and no notification when someone hearts your tank. It appears on the
  // Member Aquariums cards, in the aquarium preview, and as a read-only count
  // on your own tanks so you can see appreciation without farming it.
  //
  // You can't heart your own tank. The count still shows; the control just
  // isn't tappable.
  //
  // Backed by tank_likes (see tank_likes.sql). Demo mode has no database and
  // no signed-in member, so hearts are hidden entirely rather than faked.
  var likeCounts = {};      // tank id -> total hearts
  var myLikes = {};         // tank id -> true if I've hearted it
  var likeBusy = {};        // tank id -> true while a toggle is in flight
  var likesLoaded = false;

  // One query for the whole feature. The club is small enough that fetching
  // every row and counting client-side is cheaper than a per-tank aggregate,
  // and it answers both questions at once: the totals, and which ones are mine.
  async function loadTankLikes(){
    if (!sb || !window.currentMember) return;
    var res = await sb.from('tank_likes').select('tank_id, member_id');
    if (res.error) return;                 // leave hearts hidden rather than showing a wrong zero
    likeCounts = {}; myLikes = {};
    (res.data || []).forEach(function(r){
      likeCounts[r.tank_id] = (likeCounts[r.tank_id] || 0) + 1;
      if (r.member_id === window.currentMember.id) myLikes[r.tank_id] = true;
    });
    likesLoaded = true;
    renderMemberAquariums();
    renderTanks();
    // Four milestone badges read these counts, so this is a badge-changing event
    // like any other loader finishing. Debounced, so the dozen callers collapse
    // into one check once everything has settled.
    if (window.checkBadgeChanges) window.checkBadgeChanges();
  }

  var HEART_PATH = 'M12 20.7 4.6 13.4a4.6 4.6 0 0 1 6.5-6.5l.9.9.9-.9a4.6 4.6 0 1 1 6.5 6.5Z';
  function heartSvg(filled){
    return '<svg viewBox="0 0 24 24" fill="' + (filled ? 'currentColor' : 'none') +
      '" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="' + HEART_PATH + '"/></svg>';
  }

  // t         — a tank object (needs .id and .mine)
  // clickable — false renders a plain count with no button semantics
  function heartHtml(t, clickable){
    if (!sb || !window.currentMember || !t || !t.id) return '';
    var n = likeCounts[t.id] || 0;
    var mine = !!myLikes[t.id];
    var own = !!t.mine;
    // Zero hearts on your own tank is just a sad zero — say nothing instead.
    if (own && !n) return '';
    var label = own
      ? (n + ' member' + (n === 1 ? '' : 's') + ' hearted this tank')
      : (mine ? 'Remove your heart' : 'Heart this aquarium');
    if (own || !clickable){
      return '<span class="heart heart-static' + (n ? ' has' : '') + '" data-heart-static="' + escA(t.id) +
        '" title="' + escA(label) + '">' +
        heartSvg(n > 0 && !own ? mine : true) + '<b>' + n + '</b></span>';
    }
    return '<button type="button" class="heart' + (mine ? ' on' : '') + '" data-heart="' + escA(t.id) +
      '" aria-pressed="' + (mine ? 'true' : 'false') + '" aria-label="' + escA(label) + '">' +
      heartSvg(mine) + '<b>' + n + '</b></button>';
  }

  // Optimistic: the heart fills the instant it's tapped and rolls back if the
  // write fails. Same shape as markNotificationsRead — a like that takes a
  // round trip to respond feels broken even when it works.
  async function toggleTankLike(tankId){
    if (!sb || !window.currentMember || !tankId) return;
    if (likeBusy[tankId]) return;          // re-entrancy guard, per tank
    likeBusy[tankId] = true;

    var wasMine = !!myLikes[tankId];
    var before = likeCounts[tankId] || 0;
    myLikes[tankId] = !wasMine;
    likeCounts[tankId] = Math.max(0, before + (wasMine ? -1 : 1));
    paintHearts();

    var res;
    if (wasMine){
      res = await sb.from('tank_likes').delete()
        .eq('tank_id', tankId).eq('member_id', window.currentMember.id);
    } else {
      res = await sb.from('tank_likes').insert({ tank_id: tankId, member_id: window.currentMember.id });
      // The unique constraint means a duplicate isn't a failure — it means the
      // heart was already there (another tab, a double-fire). Treat 23505 as
      // success rather than rolling back something that's actually correct.
      if (res && res.error && String(res.error.code) === '23505') res = { error: null };
    }
    if (res && res.error){
      myLikes[tankId] = wasMine;
      likeCounts[tankId] = before;
      paintHearts();
      popToast('Could not save that — try again');
    }
    likeBusy[tankId] = false;
    // Hearting someone else's tank can earn Showing Love or Generous Heart
    // immediately — no reason to make the member reload to find out.
    if (window.checkBadgeChanges) window.checkBadgeChanges();
  }

  // Repaints just the hearts, rather than re-rendering the whole grid — a full
  // re-render on every tap would rebuild the cards under the member's finger.
  function paintHearts(){
    document.querySelectorAll('[data-heart]').forEach(function(btn){
      var id = btn.getAttribute('data-heart');
      var n = likeCounts[id] || 0;
      var mine = !!myLikes[id];
      btn.classList.toggle('on', mine);
      btn.setAttribute('aria-pressed', mine ? 'true' : 'false');
      btn.setAttribute('aria-label', mine ? 'Remove your heart' : 'Heart this aquarium');
      btn.innerHTML = heartSvg(mine) + '<b>' + n + '</b>';
    });
    document.querySelectorAll('.heart-static[data-heart-static]').forEach(function(el){
      var n = likeCounts[el.getAttribute('data-heart-static')] || 0;
      el.innerHTML = heartSvg(true) + '<b>' + n + '</b>';
    });
  }

  // The tank cards became div[role=button] so the heart could be a real button
  // inside them (see the card renderers). A div doesn't get Enter/Space for
  // free the way a <button> does, so that has to be restored — delegated once,
  // covering all three card grids and anything added later.
  document.addEventListener('keydown', function(e){
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    if (!e.target || !e.target.closest) return;
    // The heart is a genuine button and handles its own keys; don't also open
    // the tank behind it.
    if (e.target.closest('[data-heart]')) return;
    var card = e.target.closest('.tank-card');
    if (!card) return;
    e.preventDefault();
    card.click();
  });

  // Delegated at document level so it works on the grid, inside the preview
  // modal and inside the member drawer's gallery without three bindings, and
  // survives every re-render.
  //
  // Registered on the CAPTURE phase (the trailing `true`). The cards bind their
  // own click handlers directly on the card element, so a bubble-phase listener
  // at document level would fire *after* the card had already opened the preview
  // — stopPropagation there is too late to stop anything. Capturing means this
  // sees the tap first and can genuinely prevent the card from acting on it.
  document.addEventListener('click', function(e){
    if (!e.target || !e.target.closest) return;
    var btn = e.target.closest('[data-heart]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    toggleTankLike(btn.getAttribute('data-heart'));
  }, true);

  var maFilter = 'All';
  function renderMemberAquariums(){
    var all = getAllMemberTanks();
    var q = (document.getElementById('ma-search').value || '').toLowerCase().trim();
    var filtered = all.filter(function(t){
      if (maFilter !== 'All' && t.type !== maFilter) return false;
      if (q && (t.name + ' ' + t.owner + ' ' + t.type).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    document.getElementById('ma-count-chip').textContent = all.length + ' aquarium' + (all.length===1?'':'s');
    var grid = document.getElementById('ma-grid');
    grid.innerHTML = filtered.map(function(t, idx){
      var st = TYPE_STYLE[t.type] || TYPE_STYLE['Freshwater'];
      var initials = maInitials(t.owner);
      var gradIdx = t.mine ? 0 : (Math.abs(t.owner.split('').reduce(function(a,c){return a+c.charCodeAt(0);},0)) % MA_AVATAR_GRADS.length);
      var liveCount = t.livestock.reduce(function(a, l){ var n = parseInt(l[2],10); return a + (isNaN(n) ? (l[2] ? 1 : 0) : n); }, 0);
      var cover = coverUrl(t);
      var thumbInner = cover
        ? '<img src="' + escT(cover) + '" alt="' + escT(t.name) + '" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0">'
        : ICONS[st[2]];
      return '<div class="tank-card" role="button" tabindex="0" data-ma="' + idx + '">' +
        '<div class="tank-thumb" style="background:linear-gradient(135deg,' + st[0] + ',' + st[1] + ')">' +
          '<span class="cat-pill" style="z-index:1">' + escT(t.type) + (t.subtitle ? ' · ' + escT(t.subtitle) : '') + '</span>' + thumbInner +
        '</div><div class="tank-body">' +
          '<div class="tank-owner"><div class="mini-avatar" style="background:' + MA_AVATAR_GRADS[gradIdx] + '">' + initials + '</div><span>' + escT(t.owner) + '</span>' + (t.mine ? '<span class="mine-pill">Yours</span>' : '') + '</div>' +
          '<h4>' + escT(t.name) + '</h4>' +
          '<div class="meta">' + (t.volume ? t.volume + ' ℓ · ' : '') + escT(t.dims) + ' cm · started ' + escT(t.started) + '</div>' +
          '<div class="tank-stats"><div><b>' + (liveCount || '—') + '</b><span>Livestock</span></div><div><b>' + t.plants.length + '</b><span>Plants</span></div>' +
            (heartHtml(t, true) ? '<div class="tank-heart">' + heartHtml(t, true) + '</div>' : '') + '</div>' +
        '</div></div>';
    }).join('');
    grid.querySelectorAll('.tank-card').forEach(function(card){
      card.addEventListener('click', function(){ openMaPreview(filtered[parseInt(card.getAttribute('data-ma'),10)]); });
    });
    document.getElementById('ma-empty').style.display = filtered.length ? 'none' : 'block';
    grid.style.display = filtered.length ? 'grid' : 'none';
  }

  document.getElementById('ma-search').addEventListener('input', renderMemberAquariums);
  document.querySelectorAll('[data-maf]').forEach(function(b){
    b.addEventListener('click', function(){
      document.querySelectorAll('[data-maf]').forEach(function(x){ x.classList.remove('active'); });
      b.classList.add('active');
      maFilter = b.getAttribute('data-maf');
      renderMemberAquariums();
    });
  });

  var maModal = document.getElementById('ma-preview-modal');
  var maCurrent = null;
  // ===== Aquarium preview gallery =====
  //
  // The preview showed no photographs at all, which for an aquarium is the one
  // thing people actually want to see. Every photo a tank has is already in
  // memory from the tanks fetch (tank_photos comes down in the same nested
  // select), so this needs no extra query.
  //
  // 16/9 throughout, matching .tank-thumb on the cards, so a tank looks the same
  // shape whether you're scanning the grid or looking at one in detail.
  //
  // Tapping the main image opens the EXISTING photo lightbox rather than a
  // second viewer — the same reuse decision the drawer's gallery made when it
  // handed off to this modal. The lightbox is z-index 300 against this modal's
  // 180, so it correctly opens on top; worth stating because getting that
  // backwards is exactly what went wrong between the drawer and this preview.
  function maGalleryHtml(t){
    var st = TYPE_STYLE[t.type] || TYPE_STYLE['Freshwater'];
    var photos = (t.photos || []).filter(function(p){ return p && p.url; });
    if (!photos.length){
      // Same gradient and species icon the card falls back to, rather than an
      // empty box or a broken-image frame.
      return '<div class="ma-gal-main ma-gal-empty" style="background:linear-gradient(135deg,' +
        st[0] + ',' + st[1] + ')">' + ICONS[st[2]] + '</div>';
    }
    // Lead with whichever photo the owner chose as the cover, so the preview
    // opens on the same image the card showed.
    var cover = coverUrl(t);
    if (cover){
      photos = photos.slice().sort(function(a, b){
        return (b.url === cover ? 1 : 0) - (a.url === cover ? 1 : 0);
      });
    }
    var main = '<button type="button" class="ma-gal-main" id="ma-gal-main" data-src="' + escA(photos[0].url) +
      '" aria-label="View this photo full size">' +
      '<img src="' + escA(photos[0].url) + '" alt="' + escA(t.name) + '" loading="lazy">' +
      (photos.length > 1 ? '<span class="ma-gal-count" id="ma-gal-count">1 / ' + photos.length + '</span>' : '') +
      '</button>';
    if (photos.length < 2) return main;
    return main + '<div class="ma-gal-strip">' + photos.map(function(p, i){
      return '<button type="button" class="ma-gal-thumb' + (i === 0 ? ' on' : '') + '" data-gal="' + i +
        '" data-src="' + escA(p.url) + '" aria-label="Photo ' + (i + 1) + ' of ' + photos.length + '">' +
        '<img src="' + escA(p.url) + '" alt="" loading="lazy"></button>';
    }).join('') + '</div>';
  }

  // Bound fresh on each open because the markup is rebuilt each time. Cheap, and
  // it avoids stacking a second set of listeners on every preview.
  function wireMaGallery(wrap, total){
    var main = wrap.querySelector('#ma-gal-main');
    var count = wrap.querySelector('#ma-gal-count');
    if (main) main.addEventListener('click', function(){ openLightbox(main.getAttribute('data-src')); });
    wrap.querySelectorAll('.ma-gal-thumb').forEach(function(btn){
      btn.addEventListener('click', function(){
        var src = btn.getAttribute('data-src');
        // Swap the hero rather than opening the lightbox: a thumbnail strip that
        // jumps straight to full screen makes browsing several photos tedious.
        if (main){
          main.setAttribute('data-src', src);
          var img = main.querySelector('img');
          if (img) img.src = src;
        }
        if (count) count.textContent = (parseInt(btn.getAttribute('data-gal'), 10) + 1) + ' / ' + total;
        wrap.querySelectorAll('.ma-gal-thumb').forEach(function(b){ b.classList.remove('on'); });
        btn.classList.add('on');
      });
    });
  }

  function openMaPreview(t){
    maCurrent = t;
    document.getElementById('ma-preview-avatar').textContent = maInitials(t.owner);
    document.getElementById('ma-preview-avatar').style.background = t.mine ? 'linear-gradient(135deg,var(--leaf),var(--deep-2))' : 'linear-gradient(135deg,var(--deep),var(--leaf))';
    document.getElementById('ma-preview-owner').textContent = t.owner + (t.mine ? ' (You)' : '');
    document.getElementById('ma-preview-owner-sub').textContent = t.mine ? (window.currentMember && window.currentMember.role === 'admin' ? 'Committee member' : 'ECAAC member') : 'ECAAC member';
    document.getElementById('ma-preview-name').textContent = t.name;
    document.getElementById('ma-preview-meta').textContent = (t.volume ? t.volume + ' ℓ · ' : '') + t.dims + ' cm · ' + t.type + (t.subtitle ? ' — ' + t.subtitle : '') + ' · started ' + t.started;
    document.getElementById('ma-preview-tags').innerHTML = t.tags.map(function(x){ return '<span class="tag" style="background:#EAF3DE;border:none;color:var(--leaf-dark)">' + escT(x) + '</span>'; }).join('');
    document.getElementById('ma-preview-params').innerHTML = t.params.map(function(p){ return '<div class="preview-param"><b>' + escT(p[0]) + '</b><span>' + escT(p[1]) + '</span></div>'; }).join('');
    document.getElementById('ma-preview-livestock').innerHTML = t.livestock.length ? t.livestock.map(function(l){
      return '<div class="row"><div class="row-icon">' + fishRowIcon + '</div><div class="row-body"><b>' + escT(l[0]) + '</b><span>' + escT(l[1]||'') + '</span></div>' + (l[2] ? '<div class="row-end"><b style="color:var(--deep)">' + escT(l[2]) + '</b></div>' : '') + '</div>';
    }).join('') : '<div class="reg-empty" style="padding:18px">Nothing listed yet.</div>';
    document.getElementById('ma-preview-plants').innerHTML = t.plants.length ? t.plants.map(function(p){
      return '<div class="row"><div class="row-icon">' + plantRowIcon + '</div><div class="row-body"><b>' + escT(p[0]) + '</b><span>' + escT(p[1]||'') + '</span></div>' + (p[2] ? '<div class="row-end"><b style="color:var(--deep)">' + escT(p[2]) + '</b></div>' : '') + '</div>';
    }).join('') : '<div class="reg-empty" style="padding:18px">Nothing listed yet.</div>';
    var likeSlot = document.getElementById('ma-preview-like');
    if (likeSlot) likeSlot.innerHTML = heartHtml(t, true);
    var gal = document.getElementById('ma-preview-gallery');
    if (gal){
      gal.innerHTML = maGalleryHtml(t);
      wireMaGallery(gal, (t.photos || []).filter(function(p){ return p && p.url; }).length);
    }
    document.getElementById('ma-preview-mine-cta').style.display = t.mine ? 'block' : 'none';
    maModal.classList.add('show');
  }
  function closeMaPreview(){ maModal.classList.remove('show'); }
  document.getElementById('ma-preview-close').addEventListener('click', closeMaPreview);
  maModal.addEventListener('click', function(e){ if (e.target === maModal) closeMaPreview(); });
  document.getElementById('ma-preview-manage-btn').addEventListener('click', function(){
    if (maCurrent && maCurrent.mine){
      closeMaPreview();
      closeMemberDrawer();                      // may have been reached from the directory drawer
      show('tanks');
      openTank(maCurrent.myIndex);
    }
  });
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') closeMaPreview(); });

  renderMemberAquariums();

  // ===== Live member: patch all personal content for real logged-in users =====
  function applyLiveMember(){
    var cm = window.currentMember;
    if (!cm) return; // demo mode — leave everything as-is

    var name = member.name;
    var initials = liveInitials(cm);
    var firstName = cm.first_name || name.split(' ')[0];
    var joinYear = cm.join_date ? new Date(cm.join_date).getFullYear() : new Date().getFullYear();
    var years = Math.max(0, new Date().getFullYear() - joinYear);
    var roleLine = memberRoleLine(cm.role === 'admin', cm.membership_type);
    // keep the membership-card fields in sync too (they're built once at init)
    member.role = roleLine.toUpperCase();
    member.type = 'Annual · ' + memberTypeInfo(cm.membership_type).label;
    var daysLeft = Math.max(0, Math.ceil((nextRenewalDate() - new Date()) / 86400000));

    var LIVE = {
      'fullname': name,
      'initials': initials,
      'welcome': 'Welcome back, ' + firstName + ' 🌿',
      // The trailing-" Member" trim turns "Member · Full Member" into the shorter
      // "Member · Full". Applied to "Family Member" it would leave a bare "Family",
      // so that one is passed through whole.
      'side-sub': (isNonPaying(cm.membership_type) && cm.role !== 'admin'
        ? 'Family Member' : roleLine.replace(/ Member$/, '')) + ' · ' + member.number,
      'role-line': roleLine,
      'member-number': member.number,
      'profile-sub': (cm.role === 'admin' ? 'Committee member' : memberTypeInfo(cm.membership_type).pill) + ' · Member since ' + joinYear,
      'years-badge': years + ' year' + (years===1?'':'s') + ' a member',
      'years-num': String(years),
      'joined-label': 'Years as member · joined ' + joinYear,
      // Membership status, tier and renewal — previously hardcoded in the markup,
      // so every live member saw "Active", "Full" and "219 days" regardless.
      'mem-status': memStatusLabel(cm.status),
      'mem-status-label': 'Membership' + (renewalText(cm.renewal_date) ? ' · ' + renewalText(cm.renewal_date) : ''),
      'mem-type': memberTypeInfo(cm.membership_type).label,
      'mem-type-label': 'Annual membership type · ' + feeAmountText(memberFee(cm.membership_type)),
      // A family member has nothing to renew, so a countdown to a fee they don't
      // owe is noise at best and alarming at worst.
      'renew-days': isNonPaying(cm.membership_type) ? 'Covered' : renewalDaysText(cm.renewal_date),
      'renew-label': isNonPaying(cm.membership_type)
        ? 'No fee — covered by a household membership'
        : (renewalText(cm.renewal_date) || 'Renewal date not recorded'),
      // Placeholders, not real values — these scrub the demo figures at login and
      // are replaced by refreshAwardStats() / renderBadgeCategories() once the
      // member's entries land. A dash reads as "loading", where 0 read as fact.
      'award-points': '—',
      'award-points-label': 'Award points',
      'aw-badges': '—',
      'ev-meetings': '0 / 0'
    };
    document.querySelectorAll('[data-live]').forEach(function(el){
      var key = el.getAttribute('data-live');
      if (LIVE[key] !== undefined) el.textContent = LIVE[key];
    });

    // profile form: real values (blank where the member hasn't filled anything in yet)
    var setVal = function(id, v){ var el = document.getElementById(id); if (el) el.value = v || ''; };
    setVal('f-name', cm.first_name);
    setVal('f-surname', cm.last_name);
    setVal('f-email', cm.email);
    setVal('f-phone', cm.phone);
    setVal('f-city', cm.city);
    setSelectedInterests(cm.interests);
    setBirthdayValue(cm.birthday);
    var bioEl = document.getElementById('f-bio'); if (bioEl) bioEl.value = cm.bio || '';
    if (window.checkBirthday) window.checkBirthday();
    if (window.renderMemberTimeline) window.renderMemberTimeline();

    // dashboard recent activity: single welcome entry
    var act = document.getElementById('dash-activity');
    if (act) act.innerHTML = '<div class="row"><div class="row-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s4-6 12-6 8 6 8 6-2 6-8 6-12-6-12-6Z"/><circle cx="17" cy="10.5" r=".6" fill="currentColor" stroke="none"/></svg></div>' +
      '<div class="row-body"><b>Welcome to the members portal!</b><span>Your account is set up — start by completing your profile and adding your first aquarium.</span></div>' +
      '<div class="row-end">Today</div></div>';

    // notifications: real rows are fetched by loadNotifications()
    var notif = document.getElementById('notif-rows');
    if (notif) notif.innerHTML = '<div class="reg-empty" style="padding:22px">Loading…</div>';

    // renewal EFT reference uses the real member number
    var ref = document.getElementById('renew-ref');
    if (ref) ref.textContent = member.number;

    // renewal amount + rate note follow the member's tier (Full R270, Country/Scholar R100)
    var tInfo = memberTypeInfo(cm.membership_type);
    var amtEl = document.getElementById('renew-amount');
    if (amtEl) amtEl.textContent = feeAmountText(tInfo.fee);
    var noteEl = document.getElementById('renew-rate-note');
    if (noteEl) noteEl.innerHTML = tInfo.note;

    // Non-paying members: hide the banking details and the "I've paid" button
    // rather than inviting a payment of nothing, and take the Renew buttons out of
    // the dashboard and the FAB so nothing points at a fee they don't owe.
    var nonPaying = isNonPaying(cm.membership_type);
    var eftBox = document.getElementById('renew-eft-box');
    if (eftBox) eftBox.style.display = nonPaying ? 'none' : '';
    var renewActions = document.getElementById('renew-actions');
    if (renewActions && nonPaying) renewActions.style.display = 'none';
    var famNote = document.getElementById('renew-family-note');
    if (famNote) famNote.style.display = nonPaying ? 'flex' : 'none';
    var renewIntro = document.getElementById('renew-intro');
    if (renewIntro && nonPaying){
      renewIntro.textContent = 'Your membership is covered by a household membership, so there is nothing for you to pay. Ask the committee if you think this is wrong.';
    }
    document.querySelectorAll('#renew-open-btn, #fab-renew').forEach(function(b){
      b.style.display = nonPaying ? 'none' : '';
    });
  }
  // ===== Live Supabase wiring: roles, club news, members directory, profile save =====
  var IS_ADMIN = !!(window.currentMember && window.currentMember.role === 'admin');
  var sb = (window.currentMember && typeof supabase !== 'undefined') ? supabase : null;

  if (IS_ADMIN) {
    document.getElementById('admin-side-label').style.display = '';
    document.getElementById('admin-side-link').style.display = '';
  }

  var NEWS_BADGE_CLASS = { 'Announcement':'ok', 'Programs':'pend', 'Events':'info', 'General':'info' };
  var NEWS_CARD_TONE = ['t-leaf','t-deep','t-gold'];

  async function loadNews(){
    if (!sb) return;
    var res = await sb.from('news').select('*').order('published_at', { ascending: false });
    var rows = res.data || [];

    // dashboard: newest 3
    var grid = document.getElementById('news-grid');
    if (grid) {
      grid.innerHTML = rows.length ? rows.slice(0, 3).map(function(n, i){
        return '<div class="card ' + NEWS_CARD_TONE[i % 3] + '">' +
          '<span class="badge ' + (NEWS_BADGE_CLASS[n.badge] || 'info') + '" style="margin-bottom:10px;display:inline-block">' + escT(n.badge || 'News') + '</span>' +
          '<h4>' + escT(n.title) + '</h4><p>' + escT(n.body) + '</p></div>';
      }).join('') : '<div class="card t-leaf" style="grid-column:1/-1"><h4>No club news yet</h4><p>' + (IS_ADMIN ? 'Post the first update from the Admin Panel.' : 'Committee announcements will appear here.') + '</p></div>';
    }

    // admin list: all, with delete
    var list = document.getElementById('admin-news-list');
    if (list && IS_ADMIN) {
      list.innerHTML = rows.length ? rows.map(function(n){
        var when = n.published_at ? new Date(n.published_at).toLocaleDateString('en-ZA', { day:'numeric', month:'short' }) : '';
        return '<div class="row"><div class="row-body"><b>' + escT(n.title) + '</b><span>' + escT(n.badge || '') + ' · ' + when + '</span></div>' +
          '<button class="rm-btn" data-news-id="' + n.id + '" aria-label="Delete news item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>';
      }).join('') : '<div class="reg-empty" style="padding:20px">Nothing posted yet.</div>';
      list.querySelectorAll('[data-news-id]').forEach(function(b){
        b.addEventListener('click', async function(){
          await sb.from('news').delete().eq('id', b.getAttribute('data-news-id'));
          popToast('News item deleted');
          loadNews();
        });
      });
    }
  }

  // ===== Documents: committee-published downloads, filtered by category =====
  //
  // Two halves that have to stay in step: a `documents` row holding the title,
  // description and category, and the actual file in a *private* Storage bucket.
  // Private matters — a public bucket hands out permanent unauthenticated URLs, so
  // one leaked link would expose the constitution or minutes to anyone with it.
  // Every download below mints a 60-second signed URL instead.
  var DOC_BUCKET = 'documents';
  var DOC_MAX_BYTES = 25 * 1024 * 1024;
  var docFilter = 'All';
  var docRowsCache = [];

  function docSizeLabel(bytes){
    if (!bytes) return '';
    return bytes >= 1048576
      ? (bytes / 1048576).toFixed(1) + ' MB'
      : Math.max(1, Math.round(bytes / 1024)) + ' KB';
  }
  function docExtLabel(name){
    var m = /\.([A-Za-z0-9]+)$/.exec(name || '');
    return m ? m[1].toUpperCase() : 'FILE';
  }
  var DOC_TONE = { 'Meeting Minutes':'deep', 'Club Documents':'gold', 'Certificates':'warn' };
  var DOC_FOLDER = { 'Meeting Minutes':'minutes', 'Club Documents':'club', 'Certificates':'certificates' };
  var DOC_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></svg>';

  function renderDocs(){
    var wrap = document.getElementById('doc-rows');
    var empty = document.getElementById('doc-empty');
    var count = document.getElementById('doc-count');
    if (!wrap) return;

    var rows = docFilter === 'All'
      ? docRowsCache
      : docRowsCache.filter(function(d){ return d.category === docFilter; });

    if (count) count.textContent = rows.length + (rows.length === 1 ? ' document' : ' documents');
    if (empty) empty.style.display = rows.length ? 'none' : 'block';
    wrap.style.display = rows.length ? '' : 'none';

    wrap.innerHTML = rows.map(function(d){
      var when = d.created_at
        ? new Date(d.created_at).toLocaleDateString('en-ZA', { day:'numeric', month:'short', year:'numeric' })
        : '';
      var meta = [d.category, docExtLabel(d.file_name || d.file_path), docSizeLabel(d.file_size), when]
        .filter(Boolean).join(' \u00B7 ');
      var tone = DOC_TONE[d.category] || 'gold';
      return '<div class="row">' +
        '<div class="row-icon ' + tone + '">' + DOC_ICON + '</div>' +
        '<div class="row-body"><b>' + escT(d.title) + '</b>' +
          (d.description ? '<span>' + escT(d.description) + '</span>' : '') +
          '<span>' + escT(meta) + '</span></div>' +
        '<button class="btn btn-outline btn-sm" data-doc-dl="' + d.id + '">Download</button>' +
      '</div>';
    }).join('');

    wrap.querySelectorAll('[data-doc-dl]').forEach(function(b){
      b.addEventListener('click', function(){
        var id = b.getAttribute('data-doc-dl');
        var doc = docRowsCache.filter(function(x){ return String(x.id) === id; })[0];
        if (doc) openDocument(doc, b);
      });
    });
  }

  async function openDocument(doc, btn){
    if (!sb) return;
    var label = btn ? btn.textContent : null;
    if (btn){ btn.disabled = true; btn.textContent = 'Preparing\u2026'; }
    var res = await sb.storage.from(DOC_BUCKET).createSignedUrl(doc.file_path, 60, {
      download: doc.file_name || true
    });
    if (btn){ btn.disabled = false; btn.textContent = label; }
    if (res.error || !res.data){ popToast('Could not open that file \u2014 try again in a moment'); return; }
    window.open(res.data.signedUrl, '_blank', 'noopener');
  }

  async function loadDocuments(){
    if (!sb) return;
    var res = await sb.from('documents').select('*').order('created_at', { ascending: false });
    docRowsCache = res.data || [];
    renderDocs();

    var list = document.getElementById('admin-doc-list');
    if (list && IS_ADMIN) {
      list.innerHTML = docRowsCache.length ? docRowsCache.map(function(d){
        return '<div class="row"><div class="row-body"><b>' + escT(d.title) + '</b>' +
          '<span>' + escT(d.category) + ' \u00B7 ' + escT(docExtLabel(d.file_name || d.file_path)) + '</span></div>' +
          '<button class="rm-btn" data-doc-id="' + d.id + '" data-doc-path="' + escT(d.file_path) + '" aria-label="Delete document">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>';
      }).join('') : '<div class="reg-empty" style="padding:20px">Nothing uploaded yet.</div>';

      list.querySelectorAll('[data-doc-id]').forEach(function(b){
        b.addEventListener('click', async function(){
          // Row first, then the file: a listing pointing at a missing file is a
          // broken download members will report, while an orphaned file in the
          // bucket is invisible and harmless.
          var del = await sb.from('documents').delete().eq('id', b.getAttribute('data-doc-id'));
          if (del.error){ popToast('Could not delete \u2014 are you signed in as an admin?'); return; }
          await sb.storage.from(DOC_BUCKET).remove([b.getAttribute('data-doc-path')]);
          popToast('Document deleted');
          loadDocuments();
        });
      });
    }
  }

  var docFilterWrap = document.getElementById('doc-filters');
  if (docFilterWrap) docFilterWrap.addEventListener('click', function(e){
    var btn = e.target.closest('[data-docf]');
    if (!btn) return;
    docFilterWrap.querySelectorAll('.chip-btn').forEach(function(c){ c.classList.remove('active'); });
    btn.classList.add('active');
    docFilter = btn.getAttribute('data-docf');
    renderDocs();
  });

  var uploadingDoc = false;
  var adBtn = document.getElementById('ad-upload-btn');
  if (adBtn) adBtn.addEventListener('click', async function(){
    if (uploadingDoc || !sb) return;
    var titleEl = document.getElementById('ad-title');
    var descEl  = document.getElementById('ad-desc');
    var catEl   = document.getElementById('ad-category');
    var fileEl  = document.getElementById('ad-file');
    var errEl   = document.getElementById('ad-error');
    function fail(msg){ errEl.textContent = msg; errEl.style.display = 'block'; }

    var title = titleEl.value.trim();
    var file = fileEl.files && fileEl.files[0];
    if (!title){ fail('Give the document a title.'); return; }
    if (!file){ fail('Choose a file to upload.'); return; }
    if (file.size > DOC_MAX_BYTES){ fail('That file is larger than 25\u00A0MB \u2014 compress it or split it up.'); return; }
    errEl.style.display = 'none';

    // Timestamp-prefixed, slugged filename: keeps the original name readable in
    // the bucket without letting two "minutes.pdf" uploads collide.
    var safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    var folder = DOC_FOLDER[catEl.value] || 'club';
    var path = folder + '/' + Date.now() + '-' + safeName;

    uploadingDoc = true;
    adBtn.disabled = true; adBtn.textContent = 'Uploading\u2026';

    var up = await sb.storage.from(DOC_BUCKET).upload(path, file, {
      cacheControl: '3600', upsert: false, contentType: file.type || 'application/octet-stream'
    });
    if (up.error){
      uploadingDoc = false; adBtn.disabled = false; adBtn.textContent = 'Upload document';
      fail('Upload failed \u2014 ' + (up.error.message || 'try again.'));
      return;
    }

    var ins = await sb.from('documents').insert({
      title: title,
      description: descEl.value.trim() || null,
      category: catEl.value,
      file_path: path,
      file_name: file.name,
      file_size: file.size,
      mime_type: file.type || null,
      uploaded_by: (window.currentMember && window.currentMember.id) || null
    });

    uploadingDoc = false;
    adBtn.disabled = false; adBtn.textContent = 'Upload document';

    if (ins.error){
      // Never leave a file nobody can see or delete from the UI.
      await sb.storage.from(DOC_BUCKET).remove([path]);
      fail('Could not save the listing \u2014 ' + (ins.error.message || 'try again.'));
      return;
    }

    titleEl.value = ''; descEl.value = ''; fileEl.value = '';
    popToast('Document published \u2014 members can download it now');
    if (typeof pushNotification === 'function') {
      pushNotification('news', 'New document: ' + title, catEl.value + ' \u2014 now available in Documents.', null);
    }
    loadDocuments();
  });

  // ===== Events: real committee-managed calendar + attendance tracking =====
  var MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function eventRowToMeeting(row){
    var start = new Date(row.start_at);
    var end = row.end_at ? new Date(row.end_at) : new Date(start.getTime() + 4*3600000);
    var hours = (end - start) / 3600000;
    var timeStr = start.toLocaleTimeString('en-ZA', { hour:'2-digit', minute:'2-digit', hour12:false });
    var metaParts = [timeStr];
    if (row.location) metaParts.push(row.location);
    if (row.description) metaParts.push(row.description);
    return {
      uid: row.id, title: row.title, date: start, hours: hours,
      location: row.location || '', desc: row.description || '',
      dateLabel: [start.getDate(), MONTH_ABBR[start.getMonth()]],
      name: row.title, meta: metaParts.join(' · '),
      rsvp: false, category: row.category || 'meeting'
    };
  }

  async function loadEvents(){
    if (!sb || !window.currentMember) return;
    var res = await sb.from('events').select('*').order('start_at', { ascending: true });
    var rows = res.data || [];
    MEETINGS.length = 0;
    rows.forEach(function(r){ MEETINGS.push(eventRowToMeeting(r)); });
    renderEvents();
    renderAdminEventList(rows);
    loadMyAttendance();
  }

  async function loadMyAttendance(){
    if (!sb || !window.currentMember) return;
    var res = await sb.from('event_attendance')
      .select('*, events(start_at, category)')
      .eq('member_id', window.currentMember.id);
    var rows = res.data || [];
    var oneYearAgo = new Date(); oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    var now = new Date();
    var attendedMeetings = rows.filter(function(r){
      return r.events && r.events.category === 'meeting' && new Date(r.events.start_at) >= oneYearAgo && new Date(r.events.start_at) <= now;
    }).length;
    var totalMeetingsHeld = MEETINGS.filter(function(m){ return m.category === 'meeting' && m.date >= oneYearAgo && m.date <= now; }).length;
    var el = document.querySelector('[data-live="ev-meetings"]');
    if (el) el.textContent = attendedMeetings + ' / ' + totalMeetingsHeld;
    window.myTotalMeetingsAttended = rows.filter(function(r){ return r.events && r.events.category === 'meeting'; }).length;
    if (window.checkBadgeChanges) window.checkBadgeChanges();
  }

  // ----- Admin: create events + mark attendance -----
  var postingEvent = false;
  var anEventBtn = document.getElementById('ae-post-btn');
  if (anEventBtn) anEventBtn.addEventListener('click', async function(){
    if (postingEvent) return;
    if (!sb || !IS_ADMIN) return;
    var title = document.getElementById('ae-title').value.trim();
    var dateVal = document.getElementById('ae-date').value;
    var timeVal = document.getElementById('ae-time').value || '14:00';
    var errEl = document.getElementById('ae-error');
    if (!title || !dateVal){ errEl.style.display = 'block'; return; }
    errEl.style.display = 'none';
    postingEvent = true;
    var start = new Date(dateVal + 'T' + timeVal);
    var hours = parseFloat(document.getElementById('ae-hours').value) || 4;
    var end = new Date(start.getTime() + hours * 3600000);
    anEventBtn.disabled = true; anEventBtn.textContent = 'Posting…';
    var res = await dbInsertRow('events', {
      title: title, category: document.getElementById('ae-category').value,
      location: document.getElementById('ae-location').value.trim() || null,
      description: document.getElementById('ae-desc').value.trim() || null,
      start_at: start.toISOString(), end_at: end.toISOString(),
      created_by: window.currentMember.id
    });
    anEventBtn.disabled = false; anEventBtn.textContent = 'Post event';
    if (res.error){ popToast('Could not post — try again'); postingEvent = false; return; }
    var evLocation = document.getElementById('ae-location').value.trim();
    document.getElementById('ae-title').value = '';
    document.getElementById('ae-location').value = '';
    document.getElementById('ae-desc').value = '';
    popToast(title + ' added to the calendar');
    pushNotification('event', 'New event: ' + title,
      start.toLocaleDateString('en-ZA', { weekday:'long', day:'numeric', month:'long' }) +
      ' at ' + start.toLocaleTimeString('en-ZA', { hour:'2-digit', minute:'2-digit', hour12:false }) +
      (evLocation ? ' · ' + evLocation : ''), null);
    loadEvents();
    postingEvent = false;
  });

  function renderAdminEventList(rows){
    var list = document.getElementById('admin-event-list');
    if (!list || !IS_ADMIN) return;
    if (!rows.length){ list.innerHTML = '<div class="reg-empty" style="padding:20px">No events posted yet.</div>'; return; }
    list.innerHTML = rows.map(function(r){
      var when = new Date(r.start_at).toLocaleDateString('en-ZA', { day:'numeric', month:'short', year:'numeric' });
      return '<div class="row" style="flex-wrap:wrap;align-items:flex-start"><div class="row-body"><b>' + escT(r.title) + '</b><span>' + escT(when) + (r.location ? ' · ' + escT(r.location) : '') + '</span></div>' +
        '<button class="aw-btn approve att-toggle" data-toggle-id="' + r.id + '">Attendance</button>' +
        '<button class="rm-btn" data-event-id="' + r.id + '" aria-label="Delete event"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
        '<div style="flex-basis:100%;order:3;margin-top:10px;display:none" class="ev-attendance" data-event-id2="' + r.id + '"></div></div>';
    }).join('');
    list.querySelectorAll('[data-event-id]').forEach(function(b){
      b.addEventListener('click', async function(){
        await sb.from('events').delete().eq('id', b.getAttribute('data-event-id'));
        popToast('Event deleted');
        loadEvents();
      });
    });
    list.querySelectorAll('.att-toggle').forEach(function(b){
      b.addEventListener('click', function(){
        var box = list.querySelector('.ev-attendance[data-event-id2="' + b.getAttribute('data-toggle-id') + '"]');
        var opening = box.style.display === 'none';
        box.style.display = opening ? 'block' : 'none';
        b.textContent = opening ? 'Hide attendance' : 'Attendance';
        if (opening) renderAttendanceBox(box, b.getAttribute('data-toggle-id'));
      });
    });
  }

  async function renderAttendanceBox(box, eventId){
    var res = await sb.from('event_attendance').select('*').eq('event_id', eventId);
    var rows = res.data || [];
    var attendedIds = {};
    rows.forEach(function(a){ attendedIds[a.member_id] = a.id; });
    var members = (window.__liveMemberList || []).slice().sort(function(a, b){
      var na = ((a.first_name||'')+(a.last_name||'')).toLowerCase(), nb = ((b.first_name||'')+(b.last_name||'')).toLowerCase();
      return na < nb ? -1 : na > nb ? 1 : 0;
    });
    box.innerHTML =
      '<div style="font-size:12px;color:var(--ink-soft);margin-bottom:8px">' + rows.length + ' of ' + members.length + ' members marked as attended — tick to mark, untick to remove</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:6px 14px">' + members.map(function(m){
        var nm = ((m.first_name||'') + ' ' + (m.last_name||'')).trim() || 'New member';
        var checked = !!attendedIds[m.id];
        return '<label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">' +
          '<input type="checkbox" class="att-check" data-member-id="' + m.id + '" data-att-id="' + (attendedIds[m.id] || '') + '"' + (checked ? ' checked' : '') + '> ' + escT(nm) +
        '</label>';
      }).join('') + '</div>';
    box.querySelectorAll('.att-check').forEach(function(cb){
      cb.addEventListener('change', async function(){
        var memberId = cb.getAttribute('data-member-id');
        cb.disabled = true;
        if (cb.checked){
          var r = await dbInsertRow('event_attendance', { event_id: eventId, member_id: memberId, marked_by: window.currentMember.id });
          if (r.error){ popToast('Could not mark attendance — try again'); cb.checked = false; cb.disabled = false; return; }
          cb.setAttribute('data-att-id', r.data ? r.data.id : '');
        } else {
          var attId = cb.getAttribute('data-att-id');
          if (attId) await dbDeleteRow('event_attendance', attId);
        }
        cb.disabled = false;
        var countEl = box.querySelector('div');
        var newCount = box.querySelectorAll('.att-check:checked').length;
        if (countEl) countEl.textContent = newCount + ' of ' + members.length + ' members marked as attended — tick to mark, untick to remove';
      });
    });
  }

  // ----- Admin: bulk attendance import from CSV -----
  function attParseCSV(text){
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    var rows = [], row = [], field = '', i = 0, q = false;
    while (i < text.length){
      var c = text[i];
      if (q){
        if (c === '"'){ if (text[i+1] === '"'){ field += '"'; i += 2; continue; } q = false; i++; continue; }
        field += c; i++; continue;
      }
      if (c === '"'){ q = true; i++; continue; }
      if (c === ','){ row.push(field); field = ''; i++; continue; }
      if (c === '\n'){ row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++;
    }
    if (field.length || row.length){ row.push(field); rows.push(row); }
    return rows.filter(function(r){ return r.some(function(x){ return x.trim() !== ''; }); });
  }
  function attPad(n){ return (n < 10 ? '0' : '') + n; }
  function attDateKey(d){ return d.getFullYear() + '-' + attPad(d.getMonth() + 1) + '-' + attPad(d.getDate()); }
  function attNormaliseDate(raw){
    raw = (raw || '').trim();
    var m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return m[1] + '-' + attPad(+m[2]) + '-' + attPad(+m[3]);
    m = raw.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/); // DD/MM/YYYY
    if (m) return m[3] + '-' + attPad(+m[2]) + '-' + attPad(+m[1]);
    var d = new Date(raw);
    return isNaN(d.getTime()) ? null : attDateKey(d);
  }

  var attImporting = false;
  var attCsvBtn = document.getElementById('att-csv-btn');
  if (attCsvBtn) attCsvBtn.addEventListener('click', async function(){
    if (attImporting) return;
    if (!sb || !IS_ADMIN){ popToast('Admins only'); return; }
    var fileEl = document.getElementById('att-csv-file');
    var logEl = document.getElementById('att-import-log');
    var file = fileEl && fileEl.files && fileEl.files[0];
    if (!file){ popToast('Choose a CSV file first'); return; }
    attImporting = true; attCsvBtn.disabled = true; attCsvBtn.textContent = 'Importing…';
    try {
      var grid = attParseCSV(await file.text());
      if (grid.length < 2){ logEl.innerHTML = '<span style="color:var(--coral-dark)">That file has no data rows.</span>'; return; }
      var header = grid[0].map(function(h){ return h.trim().toLowerCase(); });
      function col(names){ for (var k = 0; k < names.length; k++){ var idx = header.indexOf(names[k]); if (idx !== -1) return idx; } return -1; }
      var iNum = col(['membership_number','member_number','membership','memberno']);
      var iEmail = col(['email','e-mail']);
      var iName = col(['name','member','full name','member name']);
      var iDate = col(['event_date','date','meeting_date']);
      var iTitle = col(['event_title','title','event','meeting']);
      if (iDate === -1 || (iNum === -1 && iEmail === -1 && iName === -1)){
        logEl.innerHTML = '<span style="color:var(--coral-dark)">Missing columns. Need an <b>event_date</b> column and one of <b>membership_number</b>, <b>email</b> or <b>name</b>.</span>';
        return;
      }
      // member lookups
      var byNum = {}, byEmail = {}, byName = {};
      (window.__liveMemberList || []).forEach(function(mm){
        if (mm.membership_number) byNum[String(mm.membership_number).trim().toLowerCase()] = mm;
        if (mm.email) byEmail[String(mm.email).trim().toLowerCase()] = mm;
        var nm = ((mm.first_name || '') + ' ' + (mm.last_name || '')).trim().toLowerCase();
        if (nm) byName[nm] = mm;
      });
      // event lookups by date
      var evRes = await sb.from('events').select('id, title, start_at');
      var evByDate = {};
      (evRes.data || []).forEach(function(e){
        var key = attDateKey(new Date(e.start_at));
        (evByDate[key] = evByDate[key] || []).push(e);
      });
      // resolve each data row
      var parsed = [], problems = [], eventIdsInFile = {};
      for (var r = 1; r < grid.length; r++){
        var rowArr = grid[r];
        var member = null, who = '';
        if (iNum !== -1 && (rowArr[iNum] || '').trim()){ who = rowArr[iNum].trim(); member = byNum[who.toLowerCase()]; }
        if (!member && iEmail !== -1 && (rowArr[iEmail] || '').trim()){ who = rowArr[iEmail].trim(); member = byEmail[who.toLowerCase()]; }
        if (!member && iName !== -1 && (rowArr[iName] || '').trim()){ who = rowArr[iName].trim(); member = byName[who.toLowerCase()]; }
        var dateKey = attNormaliseDate(rowArr[iDate]);
        if (!member){ problems.push('Row ' + (r+1) + ': no member matches \u201C' + (who || '(blank)') + '\u201D'); continue; }
        if (!dateKey){ problems.push('Row ' + (r+1) + ': couldn\u2019t read date \u201C' + (rowArr[iDate] || '') + '\u201D'); continue; }
        var evs = evByDate[dateKey] || [];
        if (iTitle !== -1 && (rowArr[iTitle] || '').trim() && evs.length > 1){
          var wantT = rowArr[iTitle].trim().toLowerCase();
          evs = evs.filter(function(e){ return (e.title || '').trim().toLowerCase() === wantT; });
        }
        if (evs.length === 0){ problems.push('Row ' + (r+1) + ': no event on ' + dateKey); continue; }
        if (evs.length > 1){ problems.push('Row ' + (r+1) + ': more than one event on ' + dateKey + ' \u2014 add an event_title column'); continue; }
        eventIdsInFile[evs[0].id] = true;
        parsed.push({ event_id: evs[0].id, member_id: member.id });
      }
      // skip attendance that already exists
      var existingSet = {}, evIdList = Object.keys(eventIdsInFile);
      if (evIdList.length){
        var exRes = await sb.from('event_attendance').select('event_id, member_id').in('event_id', evIdList);
        (exRes.data || []).forEach(function(a){ existingSet[a.event_id + '|' + a.member_id] = true; });
      }
      var toInsert = [], seen = {}, already = 0;
      parsed.forEach(function(p){
        var key = p.event_id + '|' + p.member_id;
        if (existingSet[key]){ already++; return; }
        if (seen[key]) return;
        seen[key] = true;
        toInsert.push({ event_id: p.event_id, member_id: p.member_id, marked_by: window.currentMember.id });
      });
      var inserted = 0, insertErr = null;
      if (toInsert.length){
        var insRes = await sb.from('event_attendance').insert(toInsert).select('id');
        if (insRes.error) insertErr = insRes.error; else inserted = (insRes.data || []).length;
      }
      // report
      var html;
      if (insertErr){
        html = '<div style="color:var(--coral-dark);font-weight:700">Import failed: ' + escT(insertErr.message || 'database error') + '. Check that the event_attendance table allows admin inserts.</div>';
      } else {
        var parts = ['<b>' + inserted + '</b> new attendance record' + (inserted === 1 ? '' : 's') + ' added.'];
        if (already) parts.push('<b>' + already + '</b> already recorded (skipped).');
        if (problems.length) parts.push('<b>' + problems.length + '</b> row' + (problems.length === 1 ? '' : 's') + ' couldn\u2019t be matched.');
        html = '<div style="color:var(--leaf-dark);font-weight:700;margin-bottom:6px">' + parts.join(' ') + '</div>';
        if (problems.length){
          html += '<details style="margin-top:6px"><summary style="cursor:pointer;color:var(--ink-soft)">Show unmatched rows</summary>' +
            '<ul style="margin:8px 0 0;padding-left:18px;color:var(--ink-soft)">' +
            problems.slice(0, 50).map(function(p){ return '<li>' + escT(p) + '</li>'; }).join('') +
            (problems.length > 50 ? '<li>\u2026and ' + (problems.length - 50) + ' more</li>' : '') +
            '</ul></details>';
        }
      }
      logEl.innerHTML = html;
      if (inserted){
        popToast(inserted + ' attendance record' + (inserted === 1 ? '' : 's') + ' imported');
        if (fileEl) fileEl.value = '';
        // Recomputes MEETINGS and calls loadMyAttendance(), which refreshes the
        // signed-in member's last-12-months score and re-runs badge checks.
        loadEvents();
      }
    } catch (err){
      document.getElementById('att-import-log').innerHTML = '<span style="color:var(--coral-dark)">Could not read that file \u2014 is it a valid CSV?</span>';
    } finally {
      attImporting = false; attCsvBtn.disabled = false; attCsvBtn.textContent = 'Import attendance';
    }
  });

  var attTemplateBtn = document.getElementById('att-csv-template');
  if (attTemplateBtn) attTemplateBtn.addEventListener('click', function(){
    var sampleNum = 'ECAAC-0001';
    var m0 = (window.__liveMemberList || [])[0];
    if (m0 && m0.membership_number) sampleNum = m0.membership_number;
    var sampleDate = attDateKey(new Date());
    var pastM = MEETINGS.filter(function(m){ return m.date <= new Date(); }).sort(function(a,b){ return b.date - a.date; })[0];
    if (pastM) sampleDate = attDateKey(pastM.date);
    var csv = 'membership_number,event_date\n' + sampleNum + ',' + sampleDate + '\n';
    var blob = new Blob([csv], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = 'ecaac-attendance-template.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
  });

  // ----- Admin: bulk auction lot import from CSV -----
  // Reuses attParseCSV / attNormaliseDate / attDateKey from the attendance import.
  var alotImporting = false;
  var alotCsvBtn = document.getElementById('alot-csv-btn');
  if (alotCsvBtn) alotCsvBtn.addEventListener('click', async function(){
    if (alotImporting) return;
    if (!sb || !IS_ADMIN){ popToast('Admins only'); return; }
    var fileEl = document.getElementById('alot-csv-file');
    var logEl = document.getElementById('alot-import-log');
    var file = fileEl && fileEl.files && fileEl.files[0];
    if (!file){ popToast('Choose a CSV file first'); return; }
    alotImporting = true; alotCsvBtn.disabled = true; alotCsvBtn.textContent = 'Importing…';
    try {
      var grid = attParseCSV(await file.text());
      if (grid.length < 2){ logEl.innerHTML = '<span style="color:var(--coral-dark)">That file has no data rows.</span>'; return; }
      var header = grid[0].map(function(h){ return h.trim().toLowerCase(); });
      function col(names){ for (var k = 0; k < names.length; k++){ var idx = header.indexOf(names[k]); if (idx !== -1) return idx; } return -1; }
      var iNum = col(['membership_number','member_number','membership','memberno']);
      var iEmail = col(['email','e-mail']);
      var iName = col(['name','member','full name','member name']);
      var iDate = col(['auction_date','date','event_date']);
      var iItem = col(['item','description','lot','lot_item']);
      var iRole = col(['role','type','buy_sell','bought_sold']);
      var iAmount = col(['amount','price','value','r','rand']);
      if (iDate === -1 || iItem === -1 || iRole === -1 || iAmount === -1 || (iNum === -1 && iEmail === -1 && iName === -1)){
        logEl.innerHTML = '<span style="color:var(--coral-dark)">Missing columns. Need <b>auction_date</b>, <b>item</b>, <b>role</b> and <b>amount</b>, plus one of <b>membership_number</b>, <b>email</b> or <b>name</b>.</span>';
        return;
      }
      // member lookups
      var byNum = {}, byEmail = {}, byName = {};
      (window.__liveMemberList || []).forEach(function(mm){
        if (mm.membership_number) byNum[String(mm.membership_number).trim().toLowerCase()] = mm;
        if (mm.email) byEmail[String(mm.email).trim().toLowerCase()] = mm;
        var nm = ((mm.first_name || '') + ' ' + (mm.last_name || '')).trim().toLowerCase();
        if (nm) byName[nm] = mm;
      });
      // resolve each data row
      var parsed = [], problems = [], datesInFile = {};
      for (var r = 1; r < grid.length; r++){
        var rowArr = grid[r];
        var mem = null, who = '';
        if (iNum !== -1 && (rowArr[iNum] || '').trim()){ who = rowArr[iNum].trim(); mem = byNum[who.toLowerCase()]; }
        if (!mem && iEmail !== -1 && (rowArr[iEmail] || '').trim()){ who = rowArr[iEmail].trim(); mem = byEmail[who.toLowerCase()]; }
        if (!mem && iName !== -1 && (rowArr[iName] || '').trim()){ who = rowArr[iName].trim(); mem = byName[who.toLowerCase()]; }
        if (!mem){ problems.push('Row ' + (r+1) + ': no member matches \u201C' + (who || '(blank)') + '\u201D'); continue; }
        var dateKey = attNormaliseDate(rowArr[iDate]);
        if (!dateKey){ problems.push('Row ' + (r+1) + ': couldn\u2019t read date \u201C' + (rowArr[iDate] || '') + '\u201D'); continue; }
        var item = (rowArr[iItem] || '').trim();
        if (!item){ problems.push('Row ' + (r+1) + ': item is blank'); continue; }
        var roleRaw = (rowArr[iRole] || '').trim().toLowerCase();
        var role = (roleRaw === 'sold' || roleRaw === 'sell' || roleRaw === 'seller' || roleRaw === 's') ? 'Sold'
                 : (roleRaw === 'bought' || roleRaw === 'buy' || roleRaw === 'buyer' || roleRaw === 'b') ? 'Bought'
                 : null;
        if (!role){ problems.push('Row ' + (r+1) + ': role must be Bought or Sold, got \u201C' + (rowArr[iRole] || '') + '\u201D'); continue; }
        var amount = parseFloat(String(rowArr[iAmount] || '').replace(/[R\s,]/gi, ''));
        if (!isFinite(amount) || amount <= 0){ problems.push('Row ' + (r+1) + ': couldn\u2019t read amount \u201C' + (rowArr[iAmount] || '') + '\u201D'); continue; }
        amount = Math.round(amount * 100) / 100;
        datesInFile[dateKey] = true;
        parsed.push({ member_id: mem.id, auction_date: dateKey, item: item, role: role, amount: amount });
      }
      // Re-importing the same file must not double up, but two genuinely separate
      // lots CAN be identical — a member selling two bags of the same shrimp at
      // the same price on the same night is ordinary, not a mistake. So the check
      // counts occurrences rather than testing existence: if the file holds three
      // matching lots and the database already holds one, two get inserted.
      //
      // The previous version keyed on existence alone, which silently dropped the
      // second and subsequent copies of any identical row — the file said three,
      // one landed, and nothing in the report said otherwise.
      var existingCount = {}, dateList = Object.keys(datesInFile);
      if (dateList.length){
        var exRes = await sb.from('auction_lots').select('member_id, auction_date, item, role, amount').in('auction_date', dateList);
        (exRes.data || []).forEach(function(a){
          var k = [a.member_id, a.auction_date, String(a.item).trim().toLowerCase(), a.role, Number(a.amount)].join('|');
          existingCount[k] = (existingCount[k] || 0) + 1;
        });
      }
      // Walk the file in order, allocating each row against what the database
      // already holds. The first N copies of a key are treated as the ones already
      // recorded; every copy beyond that is a new lot.
      var toInsert = [], usedCount = {}, already = 0;
      parsed.forEach(function(p){
        var key = [p.member_id, p.auction_date, p.item.toLowerCase(), p.role, p.amount].join('|');
        usedCount[key] = (usedCount[key] || 0) + 1;
        if (usedCount[key] <= (existingCount[key] || 0)){ already++; return; }
        toInsert.push({ member_id: p.member_id, auction_date: p.auction_date, item: p.item, role: p.role, amount: p.amount, created_by: window.currentMember.id });
      });
      var inserted = 0, insertErr = null;
      if (toInsert.length){
        var insRes = await sb.from('auction_lots').insert(toInsert).select('id');
        if (insRes.error) insertErr = insRes.error; else inserted = (insRes.data || []).length;
      }
      // report
      var html;
      if (insertErr){
        html = '<div style="color:var(--coral-dark);font-weight:700">Import failed: ' + escT(insertErr.message || 'database error') + '. Check that the auction_lots table allows admin inserts.</div>';
      } else {
        var parts = ['<b>' + inserted + '</b> lot' + (inserted === 1 ? '' : 's') + ' added.'];
        if (already) parts.push('<b>' + already + '</b> already recorded (skipped).');
        if (problems.length) parts.push('<b>' + problems.length + '</b> row' + (problems.length === 1 ? '' : 's') + ' couldn\u2019t be imported.');
        html = '<div style="color:var(--leaf-dark);font-weight:700;margin-bottom:6px">' + parts.join(' ') + '</div>';
        if (problems.length){
          html += '<details style="margin-top:6px"><summary style="cursor:pointer;color:var(--ink-soft)">Show skipped rows</summary>' +
            '<ul style="margin:8px 0 0;padding-left:18px;color:var(--ink-soft)">' +
            problems.slice(0, 50).map(function(p){ return '<li>' + escT(p) + '</li>'; }).join('') +
            (problems.length > 50 ? '<li>\u2026and ' + (problems.length - 50) + ' more</li>' : '') +
            '</ul></details>';
        }
      }
      logEl.innerHTML = html;
      if (inserted){
        popToast(inserted + ' auction lot' + (inserted === 1 ? '' : 's') + ' imported');
        if (fileEl) fileEl.value = '';
        loadAdminAuctionList();
        loadMyAuctionLots();
      }
    } catch (err){
      document.getElementById('alot-import-log').innerHTML = '<span style="color:var(--coral-dark)">Could not read that file \u2014 is it a valid CSV?</span>';
    } finally {
      alotImporting = false; alotCsvBtn.disabled = false; alotCsvBtn.textContent = 'Import lots';
    }
  });

  var alotTemplateBtn = document.getElementById('alot-csv-template');
  if (alotTemplateBtn) alotTemplateBtn.addEventListener('click', function(){
    var sampleNum = 'ECAAC-0001';
    var m0 = (window.__liveMemberList || [])[0];
    if (m0 && m0.membership_number) sampleNum = m0.membership_number;
    var sampleDate = attDateKey(new Date());
    var csv = 'membership_number,auction_date,item,role,amount\n' +
      sampleNum + ',' + sampleDate + ',"Pair of Apistogramma cacatuoides",Sold,250\n' +
      sampleNum + ',' + sampleDate + ',"Bag of Java moss",Bought,40\n';
    var blob = new Blob([csv], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = 'ecaac-auction-lots-template.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
  });

  // ===== Notifications feed + preferences =====
  // Broadcasts (member_id null) are club-wide and stored once; personal notifications
  // carry a member_id. Read state lives in notification_reads, so a broadcast never
  // needs fanning out into one row per member.
  var NOTIF_ICONS = {
    award: '<path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4Z"/>',
    event: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    news:  '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/>',
    resource: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/>',
    renewal: '<path d="M16 3H8l-2 5h12l-2-5Z"/><path d="M4 8h16l-1.5 12a2 2 0 0 1-2 2H7.5a2 2 0 0 1-2-2L4 8Z"/>',
    general: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>'
  };
  var NOTIF_ICON_TONE = { award:'gold', event:'', news:'deep', resource:'deep', renewal:'warn', general:'' };
  // notification kind -> the preference checkbox that controls it
  var NOTIF_PREF_FOR_KIND = {
    award: 'award_updates', event: 'event_reminders', news: 'committee_announcements',
    resource: 'resource_alerts', renewal: 'renewal_reminders'
  };
  var NOTIF_PREF_FIELDS = ['award_updates','event_reminders','committee_announcements','resource_alerts','renewal_reminders'];
  var NOTIF_PREF_INPUTS = {
    award_updates: 'np-award', event_reminders: 'np-event', committee_announcements: 'np-news',
    resource_alerts: 'np-resource', renewal_reminders: 'np-renewal'
  };
  var NOTIF_PREF_DEFAULTS = {
    award_updates: true, event_reminders: true, committee_announcements: true,
    resource_alerts: false, renewal_reminders: true
  };
  var myNotifPrefs = null;   // null until loaded; general kind is always shown
  var myNotifications = [];

  function notifAgo(iso){
    var then = new Date(iso), now = new Date();
    var mins = Math.round((now - then) / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return mins + ' minute' + (mins === 1 ? '' : 's') + ' ago';
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + ' hour' + (hrs === 1 ? '' : 's') + ' ago';
    var days = Math.round(hrs / 24);
    if (days === 1) return 'Yesterday';
    if (days < 7) return days + ' days ago';
    var wks = Math.round(days / 7);
    if (wks < 5) return wks + ' week' + (wks === 1 ? '' : 's') + ' ago';
    return then.toLocaleDateString('en-ZA', { day:'numeric', month:'short', year:'numeric' });
  }

  function notifPrefAllows(kind){
    var field = NOTIF_PREF_FOR_KIND[kind];
    if (!field) return true;                       // 'general' and anything unknown always shows
    if (!myNotifPrefs) return true;                // prefs not loaded yet — don't hide anything
    return myNotifPrefs[field] !== false;
  }

  function renderNotifications(){
    var list = document.getElementById('notif-rows');
    if (!list) return;
    var visible = myNotifications.filter(function(n){ return notifPrefAllows(n.kind); });
    var unread = visible.filter(function(n){ return !n.__read; }).length;

    var headEl = document.querySelector('[data-live="notif-heading"]');
    if (headEl) headEl.textContent = unread ? unread + ' unread' : 'All caught up';
    var pill = document.getElementById('notif-pill');
    if (pill){ pill.textContent = unread; pill.style.display = unread ? '' : 'none'; }
    var dot = document.getElementById('notif-dot');
    if (dot) dot.style.display = unread ? '' : 'none';
    var markBtn = document.getElementById('notif-mark-all');
    if (markBtn) markBtn.style.display = unread ? '' : 'none';

    if (!visible.length){
      var hiddenCount = myNotifications.length - visible.length;
      list.innerHTML = '<div class="reg-empty" style="padding:22px">' +
        (hiddenCount
          ? 'Nothing to show — ' + hiddenCount + ' notification' + (hiddenCount === 1 ? ' is' : 's are') + ' hidden by your notification preferences in Settings.'
          : 'No notifications yet. Award results, committee announcements and event updates will appear here.') +
        '</div>';
      return;
    }

    list.innerHTML = visible.map(function(n){
      var tone = NOTIF_ICON_TONE[n.kind] || '';
      var path = NOTIF_ICONS[n.kind] || NOTIF_ICONS.general;
      var end = n.__read
        ? 'Read · ' + escT(notifAgo(n.created_at))
        : '<span class="badge warn">New</span><div style="margin-top:4px">' + escT(notifAgo(n.created_at)) + '</div>';
      return '<div class="row notif-row" data-notif-id="' + n.id + '"' + (n.__read ? '' : ' style="cursor:pointer"') + '>' +
        '<div class="row-icon' + (tone ? ' ' + tone : '') + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' + path + '</svg></div>' +
        '<div class="row-body"><b>' + escT(n.title) + '</b>' + (n.body ? '<span>' + escT(n.body) + '</span>' : '') + '</div>' +
        '<div class="row-end">' + end + '</div></div>';
    }).join('');

    list.querySelectorAll('.notif-row').forEach(function(row){
      row.addEventListener('click', function(){
        var id = row.getAttribute('data-notif-id');
        var n = myNotifications.filter(function(x){ return String(x.id) === String(id); })[0];
        if (n && !n.__read) markNotificationsRead([n]);
      });
    });
  }

  async function loadNotifications(){
    if (!sb || !window.currentMember) return;
    var meId = window.currentMember.id;
    var res = await sb.from('notifications')
      .select('*')
      .or('member_id.is.null,member_id.eq.' + meId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (res.error){
      var l = document.getElementById('notif-rows');
      if (l) l.innerHTML = '<div class="reg-empty" style="padding:22px">Couldn\u2019t load notifications right now.</div>';
      return;
    }
    myNotifications = res.data || [];
    var readRes = await sb.from('notification_reads').select('notification_id').eq('member_id', meId);
    var readSet = {};
    (readRes.data || []).forEach(function(r){ readSet[r.notification_id] = true; });
    myNotifications.forEach(function(n){ n.__read = !!readSet[n.id]; });
    renderNotifications();
  }

  async function markNotificationsRead(items){
    if (!sb || !window.currentMember || !items.length) return;
    var meId = window.currentMember.id;
    // optimistic: flip locally first so the UI responds immediately
    items.forEach(function(n){ n.__read = true; });
    renderNotifications();
    var rows = items.map(function(n){ return { notification_id: n.id, member_id: meId }; });
    var res = await sb.from('notification_reads').upsert(rows, { onConflict: 'notification_id,member_id' });
    if (res.error){
      items.forEach(function(n){ n.__read = false; });
      renderNotifications();
      popToast('Could not save — try again');
    }
  }

  var notifMarkBtn = document.getElementById('notif-mark-all');
  if (notifMarkBtn) notifMarkBtn.addEventListener('click', async function(){
    if (!sb || !window.currentMember){ popToast('All notifications marked as read'); return; }
    var unread = myNotifications.filter(function(n){ return !n.__read && notifPrefAllows(n.kind); });
    if (!unread.length) return;
    notifMarkBtn.disabled = true;
    await markNotificationsRead(unread);
    notifMarkBtn.disabled = false;
    popToast('All notifications marked as read');
  });

  // Create a notification. memberId null = club-wide broadcast.
  // Deliberately fire-and-forget: a notification failing must never block the
  // action that triggered it (posting news, approving an entry, and so on).
  async function pushNotification(kind, title, body, memberId){
    if (!sb) return;
    try {
      await sb.from('notifications').insert({
        member_id: memberId || null, kind: kind, title: title, body: body || null
      });
    } catch (e){ /* non-fatal */ }
  }
  window.pushNotification = pushNotification;

  // ----- preferences -----
  async function loadNotifPrefs(){
    if (!sb || !window.currentMember) return;
    var res = await sb.from('notification_prefs').select('*').eq('member_id', window.currentMember.id).maybeSingle();
    myNotifPrefs = (res && res.data) ? res.data : Object.assign({}, NOTIF_PREF_DEFAULTS);
    NOTIF_PREF_FIELDS.forEach(function(f){
      var el = document.getElementById(NOTIF_PREF_INPUTS[f]);
      if (el) el.checked = myNotifPrefs[f] !== false;
    });
    renderNotifications();
  }

  var npSaveBtn = document.getElementById('np-save');
  if (npSaveBtn) npSaveBtn.addEventListener('click', async function(){
    if (!sb || !window.currentMember){ popToast('Notification preferences saved'); return; }
    var patch = { member_id: window.currentMember.id, updated_at: new Date().toISOString() };
    NOTIF_PREF_FIELDS.forEach(function(f){
      var el = document.getElementById(NOTIF_PREF_INPUTS[f]);
      patch[f] = el ? !!el.checked : NOTIF_PREF_DEFAULTS[f];
    });
    npSaveBtn.disabled = true; npSaveBtn.textContent = 'Saving…';
    var res = await sb.from('notification_prefs').upsert(patch, { onConflict: 'member_id' });
    npSaveBtn.disabled = false; npSaveBtn.textContent = 'Save preferences';
    if (res.error){ popToast('Could not save — try again'); return; }
    myNotifPrefs = patch;
    popToast('Notification preferences saved');
    renderNotifications();
  });

  window.loadNotifications = loadNotifications;

  // ===== Auction lots: member's own read-only history + admin logging =====
  function fmtAuctionDate(iso){
    var d = new Date(iso + 'T00:00:00');
    return d.getDate() + ' ' + MONTH_ABBR_LONG[d.getMonth()] + ' ' + d.getFullYear();
  }
  var MONTH_ABBR_LONG = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  async function loadMyAuctionLots(){
    if (!sb || !window.currentMember) return;
    var res = await sb.from('auction_lots')
      .select('*')
      .eq('member_id', window.currentMember.id)
      .order('auction_date', { ascending: false });
    var rows = res.data || [];
    AUCTIONS.length = 0;
    rows.forEach(function(r){
      AUCTIONS.push({ date: fmtAuctionDate(r.auction_date), item: r.item, role: r.role, amount: parseFloat(r.amount) });
    });
    if (typeof renderAuctions === 'function') renderAuctions();
    if (window.checkBadgeChanges) window.checkBadgeChanges();
  }

  function populateMemberSelect(){
    var list = window.__liveMemberList || [];
    var opts = '<option value="">— Select a member —</option>' + list.map(function(m){
      var nm = ((m.first_name||'') + ' ' + (m.last_name||'')).trim() || 'New member';
      return '<option value="' + m.id + '">' + escT(nm) + '</option>';
    }).join('');
    var sel = document.getElementById('al-member');
    if (sel) sel.innerHTML = opts;
    var mtSel = document.getElementById('mt-member');
    if (mtSel){
      var keep = mtSel.value;
      mtSel.innerHTML = opts;
      if (keep) mtSel.value = keep;
    }
  }

  // ----- Admin: assign membership type -----
  function mtSyncFromSelection(){
    var mtSel = document.getElementById('mt-member');
    var typeSel = document.getElementById('mt-type');
    var noteEl = document.getElementById('mt-note');
    if (!mtSel || !typeSel) return;
    var row = (window.__liveMemberList || []).filter(function(m){ return String(m.id) === String(mtSel.value); })[0];
    if (!row){ typeSel.value = 'Full'; if (noteEl) noteEl.textContent = ''; return; }
    var key = memberTypeKey(row.membership_type);
    typeSel.value = key;
    if (noteEl){
      noteEl.textContent = (row.role === 'admin')
        ? 'This member is on the committee — committee members are always Full.'
        : 'Currently ' + MEMBER_TYPES[key].pill + ' · ' +
          (MEMBER_TYPES[key].fee ? fmtRand(MEMBER_TYPES[key].fee) + ' a year.' : 'no fee — covered by a household membership.');
    }
  }
  var mtMemberSel = document.getElementById('mt-member');
  if (mtMemberSel) mtMemberSel.addEventListener('change', mtSyncFromSelection);

  var mtSaving = false;
  var mtSaveBtn = document.getElementById('mt-save-btn');
  if (mtSaveBtn) mtSaveBtn.addEventListener('click', async function(){
    if (mtSaving) return;
    if (!sb || !IS_ADMIN) return;
    var memberId = document.getElementById('mt-member').value;
    var newType = memberTypeKey(document.getElementById('mt-type').value);
    var errEl = document.getElementById('mt-error');
    if (!memberId){ errEl.style.display = 'block'; return; }
    errEl.style.display = 'none';
    mtSaving = true; mtSaveBtn.disabled = true; mtSaveBtn.textContent = 'Saving…';
    var res = await sb.from('members').update({ membership_type: newType }).eq('id', memberId);
    mtSaving = false; mtSaveBtn.disabled = false; mtSaveBtn.textContent = 'Save type';
    if (res.error){ popToast('Could not save — try again'); return; }
    popToast('Membership type set to ' + MEMBER_TYPES[newType].pill);
    pushNotification('renewal', 'Your membership type changed',
      'You are now recorded as a ' + MEMBER_TYPES[newType].pill + ' — ' +
      (MEMBER_TYPES[newType].fee ? fmtRand(MEMBER_TYPES[newType].fee) + ' a year.'
                                 : 'no fee is payable, as a household membership covers you.'), memberId);
    // If the admin changed their own tier, refresh their card, role line and renewal amount.
    if (window.currentMember && String(memberId) === String(window.currentMember.id)){
      window.currentMember.membership_type = newType;
      applyLiveMember();
    }
    await loadLiveMembers();   // refreshes __liveMemberList + directory pills
    mtSyncFromSelection();
  });

  var postingLot = false;
  var alPostBtn = document.getElementById('al-post-btn');
  if (alPostBtn) alPostBtn.addEventListener('click', async function(){
    if (postingLot) return;
    if (!sb || !IS_ADMIN) return;
    var memberId = document.getElementById('al-member').value;
    var dateVal = document.getElementById('al-date').value;
    var item = document.getElementById('al-item').value.trim();
    var amount = parseFloat(document.getElementById('al-amount').value);
    var errEl = document.getElementById('al-error');
    if (!memberId || !dateVal || !item || !amount || amount <= 0){ errEl.style.display = 'block'; return; }
    errEl.style.display = 'none';
    postingLot = true;
    alPostBtn.disabled = true; alPostBtn.textContent = 'Saving…';
    var res = await dbInsertRow('auction_lots', {
      member_id: memberId, auction_date: dateVal, item: item,
      role: document.getElementById('al-role').value, amount: amount,
      created_by: window.currentMember.id
    });
    alPostBtn.disabled = false; alPostBtn.textContent = 'Log lot';
    if (res.error){ popToast('Could not save — try again'); postingLot = false; return; }
    document.getElementById('al-item').value = '';
    document.getElementById('al-amount').value = '';
    popToast('Lot logged for that member');
    loadAdminAuctionList();
    if (memberId === window.currentMember.id) loadMyAuctionLots();
    postingLot = false;
  });

  async function loadAdminAuctionList(){
    if (!sb || !IS_ADMIN) return;
    populateMemberSelect();
    var res = await sb.from('auction_lots')
      .select('*, members!member_id(first_name,last_name)')
      .order('created_at', { ascending: false })
      .limit(25);
    var rows = res.data || [];
    var list = document.getElementById('admin-auction-list');
    if (!list) return;
    if (!rows.length){ list.innerHTML = '<div class="reg-empty" style="padding:20px">No auction lots logged yet.</div>'; return; }
    list.innerHTML = rows.map(function(r){
      var nm = r.members ? ((r.members.first_name||'') + ' ' + (r.members.last_name||'')).trim() : 'Member';
      var roleBadge = r.role === 'Sold' ? '<span class="badge ok">Sold</span>' : '<span class="badge warn">Bought</span>';
      return '<div class="row"><div class="row-body"><b>' + escT(r.item) + '</b><span>' + escT(nm) + ' · ' + escT(fmtAuctionDate(r.auction_date)) + ' · R' + Number(r.amount).toFixed(2) + '</span></div>' +
        roleBadge +
        '<button class="rm-btn" data-lot-id="' + r.id + '" aria-label="Delete lot"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>';
    }).join('');
    list.querySelectorAll('[data-lot-id]').forEach(function(b){
      b.addEventListener('click', async function(){
        await dbDeleteRow('auction_lots', b.getAttribute('data-lot-id'));
        popToast('Lot deleted');
        loadAdminAuctionList();
      });
    });
  }

  // ===== Award entries: member's own list + admin approval queue =====
  var myApprovedPoints = 0;
  var myEntryRows = [];                       // raw rows, kept so tanks can be re-linked at any time
  var myProgramPoints = { BAP:0, HAP:0, AAP:0, SBP:0 };
  var mySbpSpecies = 0;                       // distinct approved species under the Specialist Breeder program
  var ENTRY_STATUS_MAP = { pending:'pend', approved:'ok', rejected:'rej' };

  // ===== Award entry photos =====
  // Mirrors the tank-photos pattern: upload to a public bucket, then record the
  // row. Paths are {member_id}/{entry_id}/{ts}-{name} so the storage policy can
  // check ownership from the first folder segment.
  var AWARD_BUCKET = 'award-photos';

  // escT() escapes & < > only, which is fine for text nodes but not for attribute
  // values — and judge comments legitimately contain double quotes, which would
  // break out of a value="..." and mangle the input. Anything interpolated into
  // an attribute below goes through escA().
  function escA(s){ return escT(s == null ? '' : s).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

  function awardThumbsHtml(photos){
    if (!photos || !photos.length) return '';
    return '<div class="aw-thumbs">' + photos.map(function(p){
      return '<img src="' + escA(p.url) + '" alt="Entry photo" loading="lazy" data-lightbox="' + escA(p.url) + '">';
    }).join('') + '</div>';
  }

  // Delegated so it works for rows rendered by either the member list or the
  // admin queue, and survives re-renders without rebinding.
  function wireAwardThumbs(container){
    if (!container) return;
    container.querySelectorAll('img[data-lightbox]').forEach(function(img){
      img.addEventListener('click', function(){ openLightbox(img.getAttribute('data-lightbox')); });
    });
  }

  // Uploads the files chosen on the submission form and attaches them to a
  // freshly-created entry. Deliberately never throws and never reports failure
  // upward as fatal: the entry itself is already saved by this point, and losing
  // a photo must not look like losing the submission. Returns a count of what
  // actually attached so the caller can be honest in its toast.
  async function uploadAwardPhotos(entryId, files, onProgress){
    var attached = 0;
    for (var i = 0; i < files.length; i++){
      var file = files[i];
      if (!file.type || file.type.indexOf('image/') !== 0){ popToast(file.name + ' skipped — not an image'); continue; }
      if (file.size > MAX_PHOTO_MB * 1024 * 1024){ popToast(file.name + ' skipped — over ' + MAX_PHOTO_MB + 'MB'); continue; }
      if (onProgress) onProgress(i + 1, files.length);
      var safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
      var path = window.currentMember.id + '/' + entryId + '/' + Date.now() + '-' + safeName;
      try {
        var upRes = await sb.storage.from(AWARD_BUCKET).upload(path, file);
        if (upRes.error){ continue; }
        var pub = sb.storage.from(AWARD_BUCKET).getPublicUrl(path);
        var dbRes = await dbInsertRow('award_entry_photos', {
          entry_id: entryId, path: path,
          url: pub.data ? pub.data.publicUrl : '',
          uploaded_by: window.currentMember.id
        });
        if (dbRes.error){
          // Object is in the bucket but unreferenced — clean it up rather than
          // leaving an orphan nobody can ever see or delete through the UI.
          try { await sb.storage.from(AWARD_BUCKET).remove([path]); } catch (e2) {}
          continue;
        }
        attached++;
      } catch (err){ /* non-fatal, counted as not attached */ }
    }
    return attached;
  }


  // Per-program tiers. NOTE: these thresholds are placeholders modelled on what
  // the demo markup implied — swap them for the club's published rules.
  var PROGRAM_TIERS = {
    BAP: { label:'Breeding Awards (BAP)',    tiers:[[50,'Breeder'],[100,'Senior Breeder'],[200,'Advanced Breeder'],[400,'Master Breeder']] },
    HAP: { label:'Horticulture Awards (HAP)',tiers:[[25,'Aquatic Gardener'],[100,'Senior Gardener'],[200,'Advanced Gardener'],[400,'Master Gardener']] },
    AAP: { label:'Aquascaping Awards (AAP)', tiers:[[30,'Showcase Entrant'],[60,'Showcase Finalist'],[120,'Showcase Master']] }
  };
  var SBP_SPECIES_TARGET = 5;

  // Attach each tank's own entries to its "Award entries from this tank" panel.
  // Split out of loadMyEntries so loadTanksFromDB can call it after it rebuilds
  // the tanks array (see the race note there).
  function applyEntriesToTanks(){
    if (!myEntryRows.length && !tanks.length) return;
    tanks.forEach(function(t){
      t.awards = myEntryRows.filter(function(r){ return r.tank_id === t.id; }).map(function(r){
        var sub = r.status === 'approved' ? ('+' + (r.points||0) + ' points · approved')
                : r.status === 'rejected' ? 'Not approved'
                : 'Submitted ' + new Date(r.submitted_at).toLocaleDateString('en-ZA', { day:'numeric', month:'short' });
        return [r.program + ' — ' + r.species, sub, r.status === 'approved' ? 'ok' : 'pend'];
      });
    });
  }

  // The two award-points stat cards are zeroed by applyLiveMember() at login and
  // were never written to again — this is what kept them reading 0 regardless of
  // approved points. Demo mode keeps its curated figures untouched.
  function refreshAwardStats(pendingCount){
    if (!sb || !window.currentMember) return;
    document.querySelectorAll('[data-live="award-points"]').forEach(function(el){
      el.textContent = entriesLoading ? '—' : String(myApprovedPoints);
    });
    document.querySelectorAll('[data-live="award-points-label"]').forEach(function(el){
      el.textContent = entriesLoading
        ? 'Award points'
        : 'Award points' + (pendingCount ? ' · ' + pendingCount + ' entr' + (pendingCount === 1 ? 'y' : 'ies') + ' pending review' : '');
    });
  }

  async function loadMyEntries(){
    if (!sb || !window.currentMember){ entriesLoading = false; renderEntries(); return; }
    var res = await sb.from('award_entries')
      .select('*, tanks(name), award_entry_photos(id,url,path)')
      .eq('member_id', window.currentMember.id)
      .order('submitted_at', { ascending: false });
    entriesLoading = false;
    // A failed fetch used to render identically to "no entries yet" *and* zero the
    // points total, which would then feed the badge engine. Bail instead.
    if (res.error){ entriesError = true; renderEntries(); return; }
    entriesError = false;
    var rows = res.data || [];
    myEntryRows = rows;
    myApprovedPoints = rows.reduce(function(sum, r){ return sum + (r.status === 'approved' ? (r.points || 0) : 0); }, 0);

    myProgramPoints = { BAP:0, HAP:0, AAP:0, SBP:0 };
    var sbpSeen = {};
    rows.forEach(function(r){
      if (r.status !== 'approved') return;
      if (myProgramPoints[r.program] !== undefined) myProgramPoints[r.program] += (r.points || 0);
      if (r.program === 'SBP' && r.species) sbpSeen[r.species.trim().toLowerCase()] = true;
    });
    mySbpSpecies = Object.keys(sbpSeen).length;

    ENTRIES.length = 0;
    rows.forEach(function(r){
      var metaParts = [];
      if (r.tanks && r.tanks.name) metaParts.push(r.tanks.name);
      if (r.status === 'approved'){
        if (r.points) metaParts.push('+' + r.points + ' points');
        if (r.judge_comment) metaParts.push('judge: "' + r.judge_comment + '"');
      } else if (r.status === 'rejected'){
        metaParts.push(r.judge_comment ? 'judge: "' + r.judge_comment + '"' : 'not approved this round');
      } else {
        metaParts.push('submitted ' + new Date(r.submitted_at).toLocaleDateString('en-ZA', { day:'numeric', month:'short', year:'numeric' }));
        metaParts.push('awaiting judge review');
      }
      ENTRIES.push({
        title: r.program + ' — ' + r.species,
        meta: metaParts.join(' · '),
        status: ENTRY_STATUS_MAP[r.status] || 'pend',
        icon: r.program === 'HAP' ? 'plant' : (r.program === 'AAP' ? 'scape' : 'fish'),
        photos: r.award_entry_photos || []
      });
    });
    renderEntries();
    applyEntriesToTanks();
    if (currentTank >= 0 && currentTank < tanks.length) renderDetail();
    if (window.renderMemberTimeline) window.renderMemberTimeline();
    if (window.checkBadgeChanges) window.checkBadgeChanges();
  }

  // ===== Awards page: "Program progress" panel =====
  // The markup for this panel is hardcoded demo data (145/200 BAP etc). In live
  // mode we replace its contents with real per-program approved points; demo mode
  // is left exactly as authored.
  function renderProgramProgress(){
    if (!sb || !window.currentMember) return;
    var wrap = document.getElementById('aw-program-progress');
    if (!wrap) return;
    if (entriesLoading){ wrap.innerHTML = '<p style="font-size:12.5px;color:var(--ink-soft);margin:0">Loading your program progress…</p>'; return; }
    if (entriesError){ wrap.innerHTML = '<p style="font-size:12.5px;color:var(--ink-soft);margin:0">Progress unavailable — your entries couldn\u2019t be loaded.</p>'; return; }

    var blocks = Object.keys(PROGRAM_TIERS).map(function(key){
      var cfg = PROGRAM_TIERS[key];
      var pts = myProgramPoints[key] || 0;
      var earned = 0;
      cfg.tiers.forEach(function(t){ if (pts >= t[0]) earned++; });
      var maxed = earned >= cfg.tiers.length;
      var prev = earned > 0 ? cfg.tiers[earned - 1][0] : 0;
      var next = maxed ? null : cfg.tiers[earned][0];
      var pct = maxed ? 100 : Math.round(((pts - prev) / (next - prev)) * 100);
      pct = Math.max(0, Math.min(100, pct));
      var tierName = maxed ? cfg.tiers[cfg.tiers.length - 1][1]
                   : (earned > 0 ? cfg.tiers[earned - 1][1] : 'Not yet ranked');
      var right = maxed ? (pts + ' pts · top tier') : (pts + ' / ' + next + ' pts');
      return '<div style="margin-bottom:16px">' +
        '<div style="display:flex;justify-content:space-between;font-size:12.5px;font-weight:700;gap:10px">' +
          '<span>' + escT(cfg.label + ' — ' + tierName) + '</span>' +
          '<span style="color:var(--leaf-dark);white-space:nowrap">' + escT(right) + '</span>' +
        '</div>' +
        '<div class="progress"><i style="width:' + pct + '%"></i></div>' +
      '</div>';
    });

    var sbpPct = Math.max(0, Math.min(100, Math.round((mySbpSpecies / SBP_SPECIES_TARGET) * 100)));
    var remaining = Math.max(0, SBP_SPECIES_TARGET - mySbpSpecies);
    blocks.push('<div>' +
      '<div style="display:flex;justify-content:space-between;font-size:12.5px;font-weight:700;gap:10px">' +
        '<span>Specialist Breeder (SBP)</span>' +
        '<span style="color:var(--leaf-dark);white-space:nowrap">' + mySbpSpecies + ' / ' + SBP_SPECIES_TARGET + ' species</span>' +
      '</div>' +
      '<div class="progress"><i style="width:' + sbpPct + '%"></i></div>' +
      '<p style="font-size:12px;color:var(--ink-soft);margin-top:8px">' + (
        remaining === 0
          ? 'Specialist Breeder recognition reached — nice work.'
          : remaining + ' more qualified species to earn Specialist Breeder recognition.'
      ) + '</p>' +
    '</div>');

    wrap.innerHTML = blocks.join('');
  }

  // ===== Awards page: badge strip =====
  // Hardcoded novelty badges in the markup; in live mode show the member's real
  // earned badges (tiers + milestones) so it agrees with the Badges page.
  function renderAwardBadgeStrip(){
    if (!sb || !window.currentMember) return;
    var strips = document.querySelectorAll('.aw-badge-strip-el');
    if (!strips.length || typeof currentEarnedBadges !== 'function') return;
    var earned = currentEarnedBadges();
    var keys = Object.keys(earned);
    var html = !keys.length
      ? '<p style="font-size:12.5px;color:var(--ink-soft);margin:0">No badges yet — every approved entry, meeting and aquarium counts toward one.</p>'
      : keys.slice(0, 8).map(function(k){
          var b = earned[k];
          return '<div class="aw-badge"><div class="ring" style="background:' + b.ringBg + '">' + b.icon + '</div>' +
            '<span>' + escT(b.title) + '</span></div>';
        }).join('');
    strips.forEach(function(strip){ strip.innerHTML = html; });
  }
  window.renderAwardBadgeStrip = renderAwardBadgeStrip;

  var AW_HISTORY_LIMIT = 25;

  function awMemberName(r){
    return (r.members ? ((r.members.first_name||'') + ' ' + (r.members.last_name||'')).trim() : '') || 'Unknown member';
  }
  function awShortDate(iso){
    return iso ? new Date(iso).toLocaleDateString('en-ZA', { day:'numeric', month:'short' }) : '';
  }

  async function loadAdminAwardQueue(){
    if (!sb || !IS_ADMIN) return;
    var list = document.getElementById('admin-aw-list');
    var countEl = document.getElementById('admin-aw-count');
    if (!list) return;

    // Two bounded queries rather than one unbounded fetch of the whole table:
    // pending must be complete (it's a work queue), but history only needs the
    // most recent slice, and pulling every entry ever — with photos joined —
    // would grow without limit as the club accumulates entries.
    var pendRes = await sb.from('award_entries')
      .select('*, members!member_id(first_name,last_name), tanks(name), award_entry_photos(id,url,path)')
      .eq('status', 'pending')
      .order('submitted_at', { ascending: true });
    var histRes = await sb.from('award_entries')
      .select('*, members!member_id(first_name,last_name), tanks(name), award_entry_photos(id,url,path)')
      .in('status', ['approved', 'rejected'])
      .order('reviewed_at', { ascending: false, nullsFirst: false })
      .limit(AW_HISTORY_LIMIT);
    if (pendRes.error){
      if (countEl) countEl.textContent = '';
      list.innerHTML = '<div class="reg-empty" style="padding:20px">Couldn\u2019t load the review queue — reload the page to try again.</div>';
      return;
    }
    var pending = pendRes.data || [];
    // History is optional garnish — if only that query fails, still show the queue.
    var reviewed = histRes.error ? [] : (histRes.data || []);

    if (countEl) countEl.textContent = pending.length + ' pending';

    var html = '';
    html += pending.length
      ? pending.map(awPendingRowHtml).join('')
      : '<div class="reg-empty" style="padding:20px">Nothing waiting for judging right now.</div>';

    if (reviewed.length){
      html += '<div class="row" style="background:var(--sand)"><div class="row-body">' +
        '<b>Recently reviewed</b><span>Last ' + reviewed.length + ' decision' + (reviewed.length === 1 ? '' : 's') +
        ' — correct the points or send an entry back to the queue.</span></div></div>';
      html += reviewed.map(awReviewedRowHtml).join('');
    }
    list.innerHTML = html;

    var byId = {};
    pending.concat(reviewed).forEach(function(r){ byId[r.id] = r; });
    wireAwardThumbs(list);
    list.querySelectorAll('.aw-review-row').forEach(function(row){ wireAwPendingRow(row, byId); });
    list.querySelectorAll('.aw-reviewed-row').forEach(function(row){ wireAwReviewedRow(row, byId); });
  }

  function awPendingRowHtml(r){
    var sub = awMemberName(r) + ' · ' + r.category + (r.tanks && r.tanks.name ? ' · ' + r.tanks.name : '') +
      ' · submitted ' + awShortDate(r.submitted_at);
    var photos = r.award_entry_photos || [];
    return '<div class="row aw-review-row" data-entry-id="' + r.id + '">' +
      '<div class="row-body"><b>' + escT(r.program + ' — ' + r.species) + '</b><span>' + escT(sub) + '</span>' +
        (r.notes ? '<span style="display:block;margin-top:2px;font-style:italic">' + escT(r.notes) + '</span>' : '') +
        (photos.length ? awardThumbsHtml(photos) : '<span class="aw-nophoto">No photos submitted</span>') +
      '</div>' +
      '<div class="aw-review-actions">' +
        '<input type="text" class="aw-comment-input" placeholder="Judge comment (optional)" aria-label="Judge comment">' +
        '<input type="number" class="aw-points-input" min="0" placeholder="Pts" aria-label="Points to award">' +
        '<button class="aw-btn approve" data-action="approve">Approve</button>' +
        '<button class="aw-btn reject" data-action="reject">Reject</button>' +
      '</div></div>';
  }

  function awReviewedRowHtml(r){
    var ok = r.status === 'approved';
    var sub = awMemberName(r) + ' · ' + r.category +
      (r.tanks && r.tanks.name ? ' · ' + r.tanks.name : '') +
      ' · reviewed ' + (awShortDate(r.reviewed_at) || 'previously') +
      (ok ? ' · +' + (r.points || 0) + ' points' : '');
    var photos = r.award_entry_photos || [];
    return '<div class="row aw-reviewed-row" data-entry-id="' + r.id + '">' +
      '<div class="row-body"><b>' + escT(r.program + ' — ' + r.species) + '</b><span>' + escT(sub) + '</span>' +
        (r.judge_comment ? '<span style="display:block;margin-top:2px;font-style:italic">' + escT(r.judge_comment) + '</span>' : '') +
        awardThumbsHtml(photos) +
      '</div>' +
      '<span class="aw-status-tag ' + (ok ? 'ok' : 'rej') + '">' + (ok ? 'Approved' : 'Not approved') + '</span>' +
      '<div class="aw-review-actions">' +
        '<input type="text" class="aw-comment-input" placeholder="Judge comment" aria-label="Judge comment" value="' + escA(r.judge_comment || '') + '">' +
        '<input type="number" class="aw-points-input" min="0" placeholder="Pts" aria-label="Points awarded" value="' + (ok && r.points ? r.points : '') + '">' +
        '<button class="aw-btn approve" data-action="save">Save</button>' +
        '<button class="aw-btn neutral" data-action="reopen">Reopen</button>' +
      '</div></div>';
  }

  function wireAwPendingRow(row, byId){
    var entryId = row.getAttribute('data-entry-id');
    var entry = byId[entryId] || {};
    var ptsInput = row.querySelector('.aw-points-input');
    var cmtInput = row.querySelector('.aw-comment-input');

    row.querySelector('[data-action="approve"]').addEventListener('click', async function(){
      var pts = parseInt(ptsInput.value, 10);
      if (!pts || pts <= 0){ ptsInput.focus(); popToast('Enter points before approving'); return; }
      this.disabled = true;
      var res2 = await sb.from('award_entries').update({
        status: 'approved', points: pts, judge_comment: cmtInput.value.trim() || null,
        reviewed_at: new Date().toISOString(), reviewed_by: window.currentMember.id
      }).eq('id', entryId);
      if (res2.error){ popToast('Could not approve — try again'); this.disabled = false; return; }
      popToast('Entry approved — +' + pts + ' points awarded');
      pushNotification('award', (entry.program || 'Award') + ' entry approved \uD83C\uDF89',
        (entry.species || 'Your entry') + ' — +' + pts + ' point' + (pts === 1 ? '' : 's') + ' awarded.', entry.member_id);
      loadAdminAwardQueue();
    });

    row.querySelector('[data-action="reject"]').addEventListener('click', async function(){
      this.disabled = true;
      var res3 = await sb.from('award_entries').update({
        status: 'rejected', judge_comment: cmtInput.value.trim() || null,
        reviewed_at: new Date().toISOString(), reviewed_by: window.currentMember.id
      }).eq('id', entryId);
      if (res3.error){ popToast('Could not update — try again'); this.disabled = false; return; }
      popToast('Entry marked not approved');
      pushNotification('award', (entry.program || 'Award') + ' entry not approved',
        (entry.species || 'Your entry') + ' wasn\u2019t approved this round — chat to the committee for feedback.', entry.member_id);
      loadAdminAwardQueue();
    });
  }

  function wireAwReviewedRow(row, byId){
    var entryId = row.getAttribute('data-entry-id');
    var entry = byId[entryId] || {};
    var ptsInput = row.querySelector('.aw-points-input');
    var cmtInput = row.querySelector('.aw-comment-input');

    // Correct a decision in place. Only notifies the member when something they'd
    // actually care about moved (points or approval status) — silently re-sending
    // "entry approved" every time a typo in the comment is fixed would be noise.
    row.querySelector('[data-action="save"]').addEventListener('click', async function(){
      var wasApproved = entry.status === 'approved';
      var newPts = wasApproved ? parseInt(ptsInput.value, 10) : null;
      if (wasApproved && (!newPts || newPts <= 0)){ ptsInput.focus(); popToast('Approved entries need a points value'); return; }
      var newCmt = cmtInput.value.trim() || null;
      if (newPts === (entry.points || null) && newCmt === (entry.judge_comment || null)){
        popToast('Nothing changed'); return;
      }
      this.disabled = true;
      var upd = { judge_comment: newCmt, reviewed_at: new Date().toISOString(), reviewed_by: window.currentMember.id };
      if (wasApproved) upd.points = newPts;
      var r = await sb.from('award_entries').update(upd).eq('id', entryId);
      if (r.error){ popToast('Could not save the correction — try again'); this.disabled = false; return; }
      if (wasApproved && newPts !== (entry.points || null)){
        popToast('Points corrected to ' + newPts);
        pushNotification('award', (entry.program || 'Award') + ' entry updated',
          (entry.species || 'Your entry') + ' — points revised to ' + newPts + '.', entry.member_id);
      } else {
        popToast('Judge comment updated');
      }
      loadAdminAwardQueue();
    });

    // Send it back to the judging queue. Points are cleared so an entry can never
    // sit in "pending" while still counting toward the member's approved total.
    row.querySelector('[data-action="reopen"]').addEventListener('click', async function(){
      this.disabled = true;
      var r = await sb.from('award_entries').update({
        status: 'pending', points: null, reviewed_at: null, reviewed_by: null
      }).eq('id', entryId);
      if (r.error){ popToast('Could not reopen — try again'); this.disabled = false; return; }
      popToast('Entry returned to the judging queue');
      loadAdminAwardQueue();
    });
  }

  var postingNews = false;
  var anPostBtn = document.getElementById('an-post-btn');
  if (anPostBtn) anPostBtn.addEventListener('click', async function(){
    if (postingNews) return;
    if (!sb) return;
    var title = document.getElementById('an-title').value.trim();
    var body = document.getElementById('an-body').value.trim();
    var errEl = document.getElementById('an-error');
    if (!title || !body){ errEl.style.display = 'block'; return; }
    errEl.style.display = 'none';
    postingNews = true;
    anPostBtn.disabled = true; anPostBtn.textContent = 'Posting…';
    var res = await sb.from('news').insert({ title: title, body: body, badge: document.getElementById('an-badge').value });
    anPostBtn.disabled = false; anPostBtn.textContent = 'Post news';
    if (res.error){ popToast('Could not post — are you signed in as an admin?'); postingNews = false; return; }
    document.getElementById('an-title').value = '';
    document.getElementById('an-body').value = '';
    popToast('News posted — every member now sees it');
    pushNotification('news', title, body.length > 140 ? body.slice(0, 137) + '…' : body, null);
    loadNews();
    postingNews = false;
  });

  async function loadLiveMembers(){
    if (!sb) return;
    var res = await sb.from('members').select('*').order('created_at', { ascending: true });
    var rows = res.data || [];
    if (!rows.length) return;
    window.__liveMemberList = rows;
    DIR.length = 0;
    rows.sort(function(a, b){ return (b.role === 'admin') - (a.role === 'admin'); });
    rows.forEach(function(m){
      var nm = ((m.first_name || '') + ' ' + (m.last_name || '')).trim() || 'New member';
      var joinYear = m.join_date ? new Date(m.join_date).getFullYear() : '';
      var interestList = String(m.interests || '').split(',').map(function(s){ return s.trim(); }).filter(Boolean);
      DIR.push({
        name: nm,
        memberId: m.id,
        joinDate: m.join_date || null,
        founding: isFoundingJoinDate(m.join_date),
        role: (m.role === 'admin' ? 'Committee' : 'Member') + (joinYear ? ' · joined ' + joinYear : ''),
        blurb: m.bio || 'This member hasn\u2019t written a bio yet.',
        cats: ['Member'],
        interests: interestList,
        typePill: memberTypeInfo(m.membership_type).pill,
        committee: m.role === 'admin',
        breeder: false, shrimp: false, listings: 0, current: 0,
        email: '', metaLine: (m.membership_number || '') + (m.province ? ' · ' + m.province : '')
      });
    });
    renderDir();
  }

  // ===== Birthday banner =====
  // Shows a top-of-page greeting when today matches the member's saved birthday
  // (month + day only). Demo mode has no birthday, so this stays dormant there.
  window.checkBirthday = function(){
    var banner = document.getElementById('bday-banner');
    if (!banner) return;
    var cm = window.currentMember;
    var bday = cm && cm.birthday;
    if (!bday){ banner.hidden = true; return; }
    var parts = String(bday).slice(0,10).split('-');
    if (parts.length !== 3){ banner.hidden = true; return; }
    var now = new Date();
    var isToday = (parseInt(parts[1],10) === now.getMonth() + 1) && (parseInt(parts[2],10) === now.getDate());
    if (!isToday){ banner.hidden = true; return; }
    var todayKey = now.getFullYear() + '-' + (now.getMonth()+1) + '-' + now.getDate();
    var dismissKey = 'ecaac-bday-dismissed-' + (cm.id || 'demo') + '-' + todayKey;
    if (localStorage.getItem(dismissKey)){ banner.hidden = true; return; }
    var fullName = [cm.first_name, cm.last_name].filter(Boolean).join(' ').trim() || (member.name || '').trim();
    var txt = document.getElementById('bday-text');
    if (txt) txt.textContent = 'Happy birthday' + (fullName ? ', ' + fullName : '') + '! The whole ECAAC club wishes you a wonderful day.';
    banner.hidden = false;
  };
  var bdayClose = document.getElementById('bday-close');
  if (bdayClose) bdayClose.addEventListener('click', function(){
    var banner = document.getElementById('bday-banner');
    if (banner) banner.hidden = true;
    var cm = window.currentMember;
    var now = new Date();
    var todayKey = now.getFullYear() + '-' + (now.getMonth()+1) + '-' + now.getDate();
    try { localStorage.setItem('ecaac-bday-dismissed-' + ((cm && cm.id) || 'demo') + '-' + todayKey, '1'); } catch(e){}
  });

  // ===== Aquarium interests: multi-select toggle chips =====
  // Stored as a comma-separated list in members.interests.
  function getSelectedInterests(){
    var box = document.getElementById('f-interests');
    if (!box) return [];
    return Array.prototype.map.call(box.querySelectorAll('.chip-btn.active'), function(c){
      return c.getAttribute('data-interest');
    });
  }
  function setSelectedInterests(str){
    var box = document.getElementById('f-interests');
    if (!box) return;
    var list = String(str || '').split(',').map(function(s){ return s.trim().toLowerCase(); }).filter(Boolean);
    box.querySelectorAll('[data-interest]').forEach(function(c){
      c.classList.toggle('active', list.indexOf(c.getAttribute('data-interest').toLowerCase()) !== -1);
    });
  }
  (function(){
    var box = document.getElementById('f-interests');
    if (!box) return;
    box.querySelectorAll('[data-interest]').forEach(function(chip){
      chip.addEventListener('click', function(){ chip.classList.toggle('active'); });
    });
  })();

  // ===== Birthday: day + month only (stored as 2000-MM-DD; year is a placeholder) =====
  function bdayDaysInMonth(month){ return month ? new Date(2000, parseInt(month, 10), 0).getDate() : 31; }
  function populateBdayDays(){
    var monthSel = document.getElementById('f-bday-month');
    var daySel = document.getElementById('f-bday-day');
    if (!monthSel || !daySel) return;
    var max = bdayDaysInMonth(monthSel.value);
    var prev = daySel.value;
    var opts = '<option value="">Day</option>';
    for (var d = 1; d <= max; d++){ opts += '<option value="' + d + '">' + d + '</option>'; }
    daySel.innerHTML = opts;
    if (prev && parseInt(prev, 10) <= max) daySel.value = prev;
  }
  function setBirthdayValue(str){
    var monthSel = document.getElementById('f-bday-month');
    var daySel = document.getElementById('f-bday-day');
    if (!monthSel || !daySel) return;
    var parts = String(str || '').slice(0, 10).split('-');
    var mm = parts.length === 3 ? parseInt(parts[1], 10) : 0;
    var dd = parts.length === 3 ? parseInt(parts[2], 10) : 0;
    monthSel.value = mm ? String(mm) : '';
    populateBdayDays();
    daySel.value = dd ? String(dd) : '';
  }
  function getBirthdayValue(){
    var monthSel = document.getElementById('f-bday-month');
    var daySel = document.getElementById('f-bday-day');
    if (!monthSel || !daySel) return null;
    var mm = parseInt(monthSel.value, 10), dd = parseInt(daySel.value, 10);
    if (!mm || !dd) return null;
    var pad = function(n){ return (n < 10 ? '0' : '') + n; };
    return '2000-' + pad(mm) + '-' + pad(dd);
  }
  (function(){
    var monthSel = document.getElementById('f-bday-month');
    if (!monthSel) return;
    monthSel.addEventListener('change', populateBdayDays);
    populateBdayDays();
  })();

  var profileSaveBtn = document.getElementById('profile-save-btn');
  if (profileSaveBtn) profileSaveBtn.addEventListener('click', async function(){
    if (!sb || !window.currentMember){ popToast('Profile changes saved'); return; }
    var cm = window.currentMember;
    var updates = {
      first_name: document.getElementById('f-name').value.trim() || null,
      last_name: document.getElementById('f-surname').value.trim() || null,
      phone: document.getElementById('f-phone').value.trim() || null,
      province: document.getElementById('f-province').value || null,
      city: document.getElementById('f-city').value.trim() || null,
      interests: getSelectedInterests().join(', ') || null,
      birthday: getBirthdayValue(),
      bio: document.getElementById('f-bio').value.trim() || null
    };
    profileSaveBtn.disabled = true; profileSaveBtn.textContent = 'Saving…';
    var res = await sb.from('members').update(updates).eq('id', cm.id);
    profileSaveBtn.disabled = false; profileSaveBtn.textContent = 'Save changes';
    if (res.error){ popToast('Could not save — try again'); return; }
    Object.assign(cm, updates);
    member.name = liveName(cm);
    applyLiveMember();
    popToast('Profile saved');
    loadLiveMembers();
    if (window.checkBadgeChanges) window.checkBadgeChanges();
  });

  // ===== Security: change password =====
  var PW_MIN = 10;
  function pwMsg(text, ok){
    var el = document.getElementById('s-pass-msg');
    if (!el) return;
    el.textContent = text;
    el.style.color = ok ? 'var(--leaf-dark)' : 'var(--coral-dark)';
    el.style.display = text ? 'block' : 'none';
  }

  var pwShow = document.getElementById('s-pass-show');
  if (pwShow) pwShow.addEventListener('change', function(){
    ['s-pass1','s-pass2','s-pass3'].forEach(function(id){
      var el = document.getElementById(id);
      if (el) el.type = pwShow.checked ? 'text' : 'password';
    });
  });

  var pwSaving = false;
  var pwBtn = document.getElementById('s-pass-btn');
  if (pwBtn) pwBtn.addEventListener('click', async function(){
    if (pwSaving) return;
    var cur = document.getElementById('s-pass1').value;
    var nw  = document.getElementById('s-pass2').value;
    var cnf = document.getElementById('s-pass3').value;

    // --- validate before touching the network ---
    if (!cur || !nw || !cnf){ pwMsg('Fill in all three password fields.', false); return; }
    if (nw.length < PW_MIN){ pwMsg('Your new password needs to be at least ' + PW_MIN + ' characters.', false); return; }
    if (nw !== cnf){ pwMsg('The new passwords don\u2019t match.', false); return; }
    if (nw === cur){ pwMsg('Your new password must be different from your current one.', false); return; }

    if (!sb || !window.currentMember){ pwMsg('', true); popToast('Password updated'); return; }

    var email = window.currentMember.email;
    if (!email){
      try { var u = await sb.auth.getUser(); email = u && u.data && u.data.user ? u.data.user.email : null; } catch (e){}
    }
    if (!email){ pwMsg('Couldn\u2019t confirm your account email — sign out and back in, then try again.', false); return; }

    pwSaving = true; pwBtn.disabled = true; pwBtn.textContent = 'Updating…';
    pwMsg('', true);

    // Supabase lets a signed-in user set a new password without proving the old
    // one. Re-authenticating first means someone on an unattended logged-in
    // session can't silently take the account over.
    var reauth = await sb.auth.signInWithPassword({ email: email, password: cur });
    if (reauth.error){
      pwSaving = false; pwBtn.disabled = false; pwBtn.textContent = 'Update password';
      pwMsg('That current password isn\u2019t right. Try again, or ask the committee to reset it for you.', false);
      return;
    }

    var res = await sb.auth.updateUser({ password: nw });
    pwSaving = false; pwBtn.disabled = false; pwBtn.textContent = 'Update password';
    if (res.error){
      var m = (res.error.message || '').toLowerCase();
      pwMsg(m.indexOf('should be different') !== -1
        ? 'Your new password must be different from your current one.'
        : 'Could not update your password — ' + (res.error.message || 'try again.'), false);
      return;
    }

    document.getElementById('s-pass1').value = '';
    document.getElementById('s-pass2').value = '';
    document.getElementById('s-pass3').value = '';
    if (pwShow && pwShow.checked){ pwShow.checked = false; pwShow.dispatchEvent(new Event('change')); }
    pwMsg('Password updated. Use your new password next time you sign in.', true);
    popToast('Password updated');
    pushNotification('general', 'Your password was changed',
      'If this wasn\u2019t you, contact the committee straight away.', window.currentMember.id);
  });

  if (window.currentMember) { loadLiveMembers(); loadNews(); loadDocuments(); loadTanksFromDB(); loadOtherMemberTanks(); loadTankLikes(); loadMyEntries(); loadAdminAwardQueue(); loadEvents(); loadMyAuctionLots(); loadAdminAuctionList(); loadNotifPrefs(); loadNotifications(); loadBreederListings(); }

  applyLiveMember();

  renderTanks();

  // Safe to call unconditionally: window.checkBadgeChanges is now debounced, so
  // this just contributes to the same settle-then-check cycle as every async
  // loader's own call — and it's what actually seeds demo mode's baseline, since
  // demo mode has no async loaders of its own to trigger it. It also now
  // refreshes the badge strip (see the debounced wrapper above), so the
  // Dashboard's copy of it isn't stuck on placeholder badges until a member
  // happens to open Awards or Badges.

  // ===== idle sign-out =====
  //
  // A Supabase session lasts indefinitely by default — nobody has ever been
  // signed out of this portal. This signs a member out after an hour of doing
  // nothing, with a minute's warning first.
  //
  // Worth being clear about what this is and isn't. It is NOT a security
  // boundary: it runs in the browser, and anyone with developer tools can stop
  // it. RLS is what actually protects members' data. This covers the realistic
  // everyday risk instead — a phone left unlocked on a table, or the shared
  // committee laptop at a club night.
  //
  // Demo mode is skipped entirely: there is no session to end.
  if (IS_LIVE) (function idleLogout(){
    var IDLE_MS = 60 * 60 * 1000;   // an hour of no interaction
    var WARN_MS = 60 * 1000;        // ...with the last minute spent warning
    var KEY = 'ecaac-last-activity-' + window.currentMember.id;

    var idleModal = document.getElementById('idle-modal');
    var countEl   = document.getElementById('idle-countdown');
    var stayBtn   = document.getElementById('idle-stay');
    var nowBtn    = document.getElementById('idle-now');
    if (!idleModal) return;

    var warning = false;
    var signingOut = false;

    // The timestamp lives in localStorage rather than a plain variable so two
    // open tabs agree — activity in one keeps the other alive, instead of an
    // idle background tab signing the member out of the tab they're using.
    function markActive(){
      try { localStorage.setItem(KEY, String(Date.now())); } catch (e) {}
    }
    function lastActive(){
      try { var v = parseInt(localStorage.getItem(KEY), 10); if (v) return v; } catch (e) {}
      return Date.now();
    }
    markActive();

    // Throttled: without this, scrolling would write to localStorage hundreds
    // of times a minute for no benefit.
    var lastWrite = 0;
    function onActivity(){
      if (warning) return;   // once the warning is up, only the button counts
      var now = Date.now();
      if (now - lastWrite < 10000) return;
      lastWrite = now;
      markActive();
    }
    ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function(ev){
      document.addEventListener(ev, onActivity, { passive: true });
    });

    async function doSignOut(){
      if (signingOut) return;
      signingOut = true;
      // Read back on the sign-in page, so an automatic sign-out doesn't look
      // like the app crashed.
      try { sessionStorage.setItem('ecaac-idle-logout', '1'); } catch (e) {}
      try { await supabase.auth.signOut(); } catch (e) { /* local session clears anyway */ }
      window.__reloadClean();
    }

    function staySignedIn(){
      warning = false;
      lastWrite = 0;
      markActive();
      closeLocked(idleModal);
    }
    if (stayBtn) stayBtn.addEventListener('click', staySignedIn);
    if (nowBtn)  nowBtn.addEventListener('click', doSignOut);

    // Everything is computed by comparing timestamps rather than by counting a
    // timer down. Phones suspend JavaScript timers when the screen locks, so a
    // decrementing counter would simply stop and the member would never be
    // signed out at all. Comparing Date.now() against the stored value survives
    // the page being frozen for an hour and gets it right on the first tick
    // after it wakes — which is also why this is re-run on visibilitychange.
    function tick(){
      if (signingOut) return;
      var idle = Date.now() - lastActive();
      if (idle >= IDLE_MS) { doSignOut(); return; }
      if (idle >= IDLE_MS - WARN_MS) {
        if (!warning) { warning = true; openLocked(idleModal); }
        if (countEl) countEl.textContent = String(Math.max(0, Math.ceil((IDLE_MS - idle) / 1000)));
      } else if (warning) {
        // Another tab was used, so this session isn't idle after all.
        staySignedIn();
      }
    }
    setInterval(tick, 1000);
    document.addEventListener('visibilitychange', function(){ if (!document.hidden) tick(); });
    window.addEventListener('focus', tick);
  })();
  if (window.checkBadgeChanges) window.checkBadgeChanges();

  // Deep link, applied last so every loader above has already been kicked off.
  //
  // The no-hash case deliberately does NOT call show('dashboard'). initPortal has
  // already marked the dashboard active directly, a few hundred lines up, for the
  // documented reason that going through show() would re-trigger that view's data
  // loaders on top of the ones the line above just started. Seeding the history
  // entry is all that's needed.
  //
  // A #/tanks or #/dashboard deep link does call show(), which refetches tanks a
  // second time. That's tolerated rather than special-cased: loadTanksFromDB is
  // idempotent and, since bug #3, refuses to clear a non-empty list on an empty
  // response, so the duplicate is a wasted request and nothing worse.
  (function initRoute(){
    var p = parseHash();
    if (!window.location.hash) { replaceRoute('dashboard'); return; }
    var shown = applyRoute(p.view, p.tank);
    if (!pendingTankKey) replaceRoute(shown);
  })();
};
