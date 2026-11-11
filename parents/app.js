/*!
 * Little Wings Parents (v1.6.0) — attendance, homework & daily updates, timetable,
 * report cards, gallery, notices, holidays, fee receipts, feedback and phone alerts.
 * Plain static app, no build step. Talks to the school's Supabase project with
 * the PUBLIC publishable key only; what a parent can see is decided by the
 * database (RLS + parent-only RPCs). Child data is cached in this browser for
 * offline viewing and removed on sign-out. Photos come from private buckets
 * through short-lived signed URLs and are never cached by the service worker.
 * Languages: English, తెలుగు, हिन्दी (English fallback).
 */
(function () {
  'use strict';

  var VERSION = '1.6.0';
  // Part B (language toggle + phone alerts): on since v1.5.0.
  var PART_B = true;
  var TZ = 'Asia/Kolkata';
  var DOMAIN = 'parents.littlewings.app';
  var OFFICE = '+91 79955 54105', OFFICE_TEL = 'tel:+917995554105';
  var CACHE = 'lwp_c_', SEEN = 'lwp_seen_', SEENP = 'lwp_seenp_';
  var CLASSES = {
    toddlers: { name: 'Toddlers', emoji: '🐣', color: '#ffc93c' },
    nursery: { name: 'Nursery', emoji: '🌱', color: '#38a8e0' },
    lkg: { name: 'LKG', emoji: '🎨', color: '#ff7a6b' },
    ukg: { name: 'UKG', emoji: '🚀', color: '#6cc48a' }
  };
  var ST = {
    P: { label: 'Present', cls: 'p', emoji: '✅', short: 'P' },
    A: { label: 'Absent', cls: 'a', emoji: '❌', short: 'A' },
    L: { label: 'Leave', cls: 'l', emoji: '🌴', short: 'L' },
    H: { label: 'Half-day', cls: 'h', emoji: '🌗', short: '½' }
  };
  var KINDS = { Homework: { emoji: '📚', label: 'Homework' }, Learned: { emoji: '🧠', label: 'What we learned' }, Meal: { emoji: '🍱', label: 'Meal' } };
  var DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MAIN_TABS = ['home', 'calendar', 'updates', 'notices', 'more'];
  var SUB_TABS = ['fees', 'timetable', 'reports', 'gallery', 'feedback', 'alerts'];
  var CLASS_MEDIA_RE = /^(toddlers|nursery|lkg|ukg)\/[A-Za-z0-9_-]{1,64}\.jpg$/;
  var GALLERY_RE = /^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,64}\.(jpg|webp|mp4|webm|mov)$/;

  var CFG = window.LW_CONFIG || {};
  var SB = (window.supabase && CFG.supabaseUrl && CFG.supabaseKey) ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'lw-parent-auth' }
  }) : null;

  /* ---------- language (English / తెలుగు / हिन्दी) ----------
   * Keys are the English text; anything missing falls back to English.
   * {0}, {1} are filled in by t(). Saved per device (localStorage 'lw-lang',
   * shared with the staff dashboard on this phone) and per login (user_metadata). */
  var I18N = {
    te: {
      'You have unsaved changes': 'మీ మార్పులు ఇంకా సేవ్ కాలేదు', 'Send your message before you leave?': 'వెళ్లే ముందు మీ సందేశాన్ని పంపాలా?', 'Keep editing': 'సవరణ కొనసాగించండి', 'Discard': 'వదిలేయండి',
      'Little Wings Parents': 'లిటిల్ వింగ్స్ పేరెంట్స్',
      'Welcome! See your child’s attendance, homework, fee receipts and school notices.': 'స్వాగతం! మీ పిల్లల హాజరు, హోంవర్క్, ఫీజు రసీదులు మరియు పాఠశాల నోటీసులు ఇక్కడ చూడండి.',
      'Mobile number': 'మొబైల్ నంబర్', 'Password': 'పాస్‌వర్డ్', 'Sign in': 'సైన్ ఇన్', 'Signing in…': 'సైన్ ఇన్ అవుతోంది…',
      'Forgot password?': 'పాస్‌వర్డ్ మర్చిపోయారా?', 'Please ask the school office:': 'దయచేసి పాఠశాల కార్యాలయాన్ని అడగండి:',
      'Enter your 10-digit mobile number': 'మీ 10 అంకెల మొబైల్ నంబర్ నమోదు చేయండి', 'Enter your password': 'మీ పాస్‌వర్డ్ నమోదు చేయండి',
      'Wrong mobile number or password.': 'మొబైల్ నంబర్ లేదా పాస్‌వర్డ్ తప్పు.', 'No internet. Please try again.': 'ఇంటర్నెట్ లేదు. మళ్ళీ ప్రయత్నించండి.',
      'Too many tries. Please wait a few minutes.': 'చాలా ప్రయత్నాలు. కొన్ని నిమిషాలు ఆగండి.',
      'Your login shows only your own child’s details.': 'మీ లాగిన్‌లో మీ పిల్లల వివరాలు మాత్రమే కనిపిస్తాయి.',
      'Show password': 'పాస్‌వర్డ్ చూపించు', 'Hide password': 'పాస్‌వర్డ్ దాచు',
      'Install app': 'యాప్ ఇన్‌స్టాల్ చేయండి', 'Install this app on your phone': 'ఈ యాప్‌ను మీ ఫోన్‌లో ఇన్‌స్టాల్ చేయండి',
      'iPhone (Safari):': 'ఐఫోన్ (Safari):', 'tap Share (square with arrow ⬆️) → Add to Home Screen → Add.': 'Share (⬆️ బాణం ఉన్న చతురస్రం) → Add to Home Screen → Add నొక్కండి.',
      'Android (Chrome):': 'ఆండ్రాయిడ్ (Chrome):', 'tap ⋮ (menu) → Install app or Add to Home screen.': '⋮ (మెనూ) → Install app లేదా Add to Home screen నొక్కండి.',
      'Loading…': 'లోడ్ అవుతోంది…', 'Loading your child’s details…': 'మీ పిల్లల వివరాలు లోడ్ అవుతున్నాయి…',
      'You have signed out. Your child’s details were removed from this phone.': 'మీరు సైన్ అవుట్ అయ్యారు. మీ పిల్లల వివరాలు ఈ ఫోన్ నుండి తొలగించబడ్డాయి.',
      'This login is not a parent login. Staff please use the school dashboard.': 'ఇది తల్లిదండ్రుల లాగిన్ కాదు. సిబ్బంది స్కూల్ డాష్‌బోర్డ్ ఉపయోగించండి.',
      'Your login was removed. Please contact the school office:': 'మీ లాగిన్ తొలగించబడింది. దయచేసి పాఠశాల కార్యాలయాన్ని సంప్రదించండి:',
      'Please sign in again.': 'దయచేసి మళ్ళీ సైన్ ఇన్ చేయండి.', 'Your session ended. Please sign in again.': 'మీ సెషన్ ముగిసింది. దయచేసి మళ్ళీ సైన్ ఇన్ చేయండి.',
      'Could not refresh. Pull down to try again.': 'రిఫ్రెష్ కాలేదు. మళ్ళీ ప్రయత్నించడానికి క్రిందికి లాగండి.',
      'You appear to be offline. Please connect to the internet and try again.': 'మీరు ఆఫ్‌లైన్‌లో ఉన్నట్లున్నారు. ఇంటర్నెట్‌కు కనెక్ట్ చేసి మళ్ళీ ప్రయత్నించండి.',
      'The app could not start. Check your internet connection and reload.': 'యాప్ ప్రారంభం కాలేదు. ఇంటర్నెట్ చూసి మళ్ళీ లోడ్ చేయండి.', 'Reload': 'మళ్ళీ లోడ్ చేయండి',
      'Refresh': 'రిఫ్రెష్', 'My account': 'నా ఖాతా', 'Choose child': 'పిల్లను ఎంచుకోండి', 'Sec': 'సెక్షన్', 'Inactive': 'నిష్క్రియ',
      'You are offline. Showing what was saved': 'మీరు ఆఫ్‌లైన్‌లో ఉన్నారు. సేవ్ చేసినవి చూపిస్తున్నాం', 'on {0}': '{0} న',
      'Present': 'హాజరు', 'Absent': 'గైర్హాజరు', 'Leave': 'సెలవు', 'Half-day': 'సగం రోజు',
      'Attendance': 'హాజరు', '{0} school days marked in {1}.': '{1} లో {0} పాఠశాల రోజులు నమోదయ్యాయి.', 'No attendance marked yet in {0}.': '{0} లో ఇంకా హాజరు నమోదు కాలేదు.',
      'School': 'పాఠశాల', 'Class': 'తరగతి', 'Pinned': 'పిన్ చేయబడింది', 'New': 'కొత్తది',
      'Class teacher': 'తరగతి ఉపాధ్యాయులు', '{0} (class teacher)': '{0} (తరగతి ఉపాధ్యాయులు)', 'School office': 'పాఠశాల కార్యాలయం',
      'Present today': 'ఈరోజు హాజరు', 'Absent today': 'ఈరోజు గైర్హాజరు', 'On leave today': 'ఈరోజు సెలవులో', 'Half-day today': 'ఈరోజు సగం రోజు',
      '{0} — holiday': '{0} — సెలవు', 'Sunday — holiday': 'ఆదివారం — సెలవు', 'Not marked yet': 'ఇంకా నమోదు కాలేదు', 'Not loaded yet': 'ఇంకా లోడ్ కాలేదు',
      'the teacher usually marks attendance in the morning': 'ఉపాధ్యాయులు సాధారణంగా ఉదయం హాజరు వేస్తారు',
      'Today': 'ఈరోజు', 'This month': 'ఈ నెల', 'Calendar': 'క్యాలెండర్', 'Latest notices': 'తాజా నోటీసులు', 'See all': 'అన్నీ చూడండి',
      'No notices right now.': 'ప్రస్తుతం నోటీసులు లేవు.', 'Holidays & events': 'సెలవులు & కార్యక్రమాలు',
      'No upcoming holidays or events.': 'రాబోయే సెలవులు లేదా కార్యక్రమాలు లేవు.', 'Event (school open)': 'కార్యక్రమం (పాఠశాల తెరిచి ఉంటుంది)', 'Holiday': 'సెలవు', 'Event': 'కార్యక్రమం',
      'Sundays are always holidays.': 'ఆదివారాలు ఎప్పుడూ సెలవులే.', 'Previous month': 'గత నెల', 'Next month': 'వచ్చే నెల',
      'Sunday / holiday': 'ఆదివారం / సెలవు', 'Not marked': 'నమోదు కాలేదు', 'Upcoming': 'రాబోయేది', 'Summary': 'సారాంశం',
      'This month is not saved on the phone. Connect to the internet to see it.': 'ఈ నెల ఫోన్‌లో సేవ్ కాలేదు. చూడటానికి ఇంటర్నెట్‌కు కనెక్ట్ చేయండి.',
      'Notices': 'నోటీసులు', 'No notices right now. School and class notices will appear here.': 'ప్రస్తుతం నోటీసులు లేవు. పాఠశాల మరియు తరగతి నోటీసులు ఇక్కడ కనిపిస్తాయి.',
      'Fees': 'ఫీజులు', 'Fee summary': 'ఫీజు సారాంశం', 'Pending fees': 'బకాయి ఫీజు', 'All paid ✓': 'అంతా చెల్లించారు ✓',
      'Please pay at the school office. Ignore if already paid today.': 'దయచేసి పాఠశాల కార్యాలయంలో చెల్లించండి. ఈరోజు చెల్లించి ఉంటే పట్టించుకోకండి.',
      'No pending fees as of {0}. Thank you! 🙏': '{0} వరకు బకాయి లేదు. ధన్యవాదాలు! 🙏',
      'Monthly fee': 'నెలవారీ ఫీజు', 'Paid ✓': 'చెల్లించారు ✓', '{0} due': '{0} బకాయి', 'Months paid': 'చెల్లించిన నెలలు', '{0} of {1}': '{1} లో {0}',
      'Total paid': 'మొత్తం చెల్లింపు', 'Sibling discount': 'తోబుట్టువుల తగ్గింపు', 'Late fee included': 'ఆలస్య రుసుము కలిపి',
      'Van fee': 'వ్యాన్ ఫీజు', '{0} / month (included above)': 'నెలకు {0} (పైన కలిపి)', '/ month': '/ నెల',
      'Counted from {0} to {1}.': '{0} నుండి {1} వరకు లెక్కించారు.', 'The monthly fee is not set yet. Please contact the school office.': 'నెలవారీ ఫీజు ఇంకా నిర్ణయించలేదు. దయచేసి కార్యాలయాన్ని సంప్రదించండి.',
      'Payments & receipts': 'చెల్లింపులు & రసీదులు', 'No payments recorded yet.': 'ఇంకా చెల్లింపులు నమోదు కాలేదు.', 'View / Print receipt': 'రసీదు చూడండి / ప్రింట్',
      'Saved {0}.': '{0} న సేవ్ చేయబడింది.', 'Questions about fees? Call': 'ఫీజు గురించి ప్రశ్నలు? కాల్ చేయండి',
      'Fee details are not shown yet.': 'ఫీజు వివరాలు ఇంకా చూపించడం లేదు.', 'The school will turn this on soon. For any fee question, please call the school office:': 'పాఠశాల త్వరలో దీన్ని ఆన్ చేస్తుంది. ఫీజు ప్రశ్నలకు కార్యాలయానికి కాల్ చేయండి:',
      'Fee details are not saved on this phone yet. Connect to the internet to see them.': 'ఫీజు వివరాలు ఈ ఫోన్‌లో ఇంకా సేవ్ కాలేదు. చూడటానికి ఇంటర్నెట్‌కు కనెక్ట్ చేయండి.',
      'Receipt': 'రసీదు', 'Print / Save as PDF': 'ప్రింట్ / PDF గా సేవ్', 'Save image': 'చిత్రంగా సేవ్', 'Share on WhatsApp': 'వాట్సాప్‌లో షేర్',
      'To save a PDF: tap Print, then choose Save as PDF (iPhone: tap Share → Save to Files).': 'PDF సేవ్ చేయడానికి: Print నొక్కి Save as PDF ఎంచుకోండి (ఐఫోన్: Share → Save to Files).',
      'Receipt image saved': 'రసీదు చిత్రం సేవ్ అయింది', 'Could not make the image': 'చిత్రం తయారు కాలేదు', 'Close': 'మూసివేయి',
      'No child is linked to this login yet.': 'ఈ లాగిన్‌కు ఇంకా పిల్లలు లింక్ కాలేదు.', 'Please contact the school office:': 'దయచేసి పాఠశాల కార్యాలయాన్ని సంప్రదించండి:',
      'Home': 'హోమ్', 'Updates': 'అప్‌డేట్స్', 'More': 'మరిన్ని', 'India time': 'భారత కాలమానం',
      'Change my password': 'నా పాస్‌వర్డ్ మార్చండి', 'New password (at least 8 characters)': 'కొత్త పాస్‌వర్డ్ (కనీసం 8 అక్షరాలు)', 'Confirm new password': 'కొత్త పాస్‌వర్డ్ నిర్ధారించండి',
      'Save new password': 'కొత్త పాస్‌వర్డ్ సేవ్ చేయండి', 'Use at least 8 characters': 'కనీసం 8 అక్షరాలు వాడండి', 'Passwords do not match': 'పాస్‌వర్డ్‌లు సరిపోలలేదు',
      'Choose a password different from the old one': 'పాత పాస్‌వర్డ్‌కు భిన్నమైనది ఎంచుకోండి', 'Password changed 🔐': 'పాస్‌వర్డ్ మార్చబడింది 🔐',
      'Need help or forgot your password? Call the school office:': 'సహాయం కావాలా లేదా పాస్‌వర్డ్ మర్చిపోయారా? కార్యాలయానికి కాల్ చేయండి:',
      'Sign out': 'సైన్ అవుట్', 'Signing out removes your child’s details from this phone.': 'సైన్ అవుట్ చేస్తే మీ పిల్లల వివరాలు ఈ ఫోన్ నుండి తొలగిపోతాయి.', 'Parent': 'తల్లిదండ్రులు',
      'Updated ✓': 'అప్‌డేట్ అయింది ✓', 'You are offline': 'మీరు ఆఫ్‌లైన్‌లో ఉన్నారు', 'App installed. Open it from your Home Screen.': 'యాప్ ఇన్‌స్టాల్ అయింది. హోమ్ స్క్రీన్ నుండి తెరవండి.',
      'New version available — tap to refresh': 'కొత్త వెర్షన్ వచ్చింది — రిఫ్రెష్ చేయడానికి నొక్కండి',
      'Language': 'భాష', 'Homework & daily updates': 'హోంవర్క్ & రోజువారీ అప్‌డేట్స్', 'Homework': 'హోంవర్క్', 'What we learned': 'ఈరోజు నేర్చుకున్నది', 'Meal': 'భోజనం',
      'No updates yet. Homework and daily notes from the class teacher will appear here.': 'ఇంకా అప్‌డేట్స్ లేవు. తరగతి ఉపాధ్యాయుల హోంవర్క్ మరియు రోజువారీ గమనికలు ఇక్కడ కనిపిస్తాయి.',
      'Showing the last 30 days.': 'గత 30 రోజులు చూపిస్తున్నాం.', 'Latest updates': 'తాజా అప్‌డేట్స్', 'Yesterday': 'నిన్న', 'Photo': 'ఫోటో',
      'Timetable': 'టైమ్‌టేబుల్', 'No timetable yet. The class teacher will add it soon.': 'ఇంకా టైమ్‌టేబుల్ లేదు. తరగతి ఉపాధ్యాయులు త్వరలో జోడిస్తారు.',
      'Time': 'సమయం', 'Full week': 'పూర్తి వారం',
      'Mon': 'సోమ', 'Tue': 'మంగళ', 'Wed': 'బుధ', 'Thu': 'గురు', 'Fri': 'శుక్ర', 'Sat': 'శని', 'Sun': 'ఆది',
      'Report cards': 'రిపోర్ట్ కార్డులు', 'Report card': 'రిపోర్ట్ కార్డు', 'No report cards yet. They appear here when the school publishes them.': 'ఇంకా రిపోర్ట్ కార్డులు లేవు. పాఠశాల ప్రచురించినప్పుడు ఇక్కడ కనిపిస్తాయి.',
      'Progress Report': 'ప్రగతి నివేదిక', 'Name': 'పేరు', 'Subject': 'విషయం', 'Marks': 'మార్కులు', 'Grade': 'గ్రేడ్', 'Total': 'మొత్తం', 'Remarks': 'వ్యాఖ్యలు',
      'Grades: A+ 90%+ · A 75%+ · B 60%+ · C 45%+ · D below 45% · AB absent': 'గ్రేడ్‌లు: A+ 90%+ · A 75%+ · B 60%+ · C 45%+ · D 45% కంటే తక్కువ · AB గైర్హాజరు',
      'Principal': 'ప్రధానోపాధ్యాయులు', 'Open': 'తెరవండి', 'Progress report': 'ప్రగతి నివేదిక',
      'Gallery': 'గ్యాలరీ', 'No photos yet. School and class albums will appear here.': 'ఇంకా ఫోటోలు లేవు. పాఠశాల మరియు తరగతి ఆల్బమ్‌లు ఇక్కడ కనిపిస్తాయి.',
      'Whole school': 'మొత్తం పాఠశాల', '{0} photos/videos': '{0} ఫోటోలు/వీడియోలు', 'Back': 'వెనుకకు', 'Video': 'వీడియో', 'Album not found.': 'ఆల్బమ్ కనిపించలేదు.',
      'Photos open only inside this app and links expire after an hour.': 'ఫోటోలు ఈ యాప్‌లో మాత్రమే తెరుచుకుంటాయి; లింక్‌లు ఒక గంటలో ముగుస్తాయి.',
      'Feedback': 'అభిప్రాయం', 'Message to the school': 'పాఠశాలకు సందేశం', 'Write your message, question or suggestion…': 'మీ సందేశం, ప్రశ్న లేదా సూచన రాయండి…',
      'Send': 'పంపండి', 'Sending…': 'పంపుతోంది…', 'Message sent. The school will reply here.': 'సందేశం పంపబడింది. పాఠశాల ఇక్కడ సమాధానం ఇస్తుంది.',
      'My messages': 'నా సందేశాలు', 'No messages yet.': 'ఇంకా సందేశాలు లేవు.', 'Seen': 'చూశారు', 'Replied': 'సమాధానం ఇచ్చారు', 'Sent': 'పంపబడింది',
      'Reply from school': 'పాఠశాల సమాధానం', 'About': 'గురించి', 'Please write at least 3 characters.': 'కనీసం 3 అక్షరాలు రాయండి.',
      'Please wait a minute before sending another message.': 'మరో సందేశం పంపే ముందు ఒక నిమిషం ఆగండి.',
      'You can send up to 5 messages a day. Please call the school for anything urgent.': 'రోజుకు 5 సందేశాలు మాత్రమే పంపగలరు. అత్యవసరమైతే పాఠశాలకు కాల్ చేయండి.',
      'Could not send. Please try again.': 'పంపలేకపోయాం. మళ్ళీ ప్రయత్నించండి.',
      'For urgent matters please call the school office.': 'అత్యవసర విషయాలకు దయచేసి కార్యాలయానికి కాల్ చేయండి.',
      'Alerts': 'హెచ్చరికలు', 'Turn on alerts': 'హెచ్చరికలు ఆన్ చేయండి', 'Turn off alerts': 'హెచ్చరికలు ఆఫ్ చేయండి', 'Send a test alert': 'పరీక్ష హెచ్చరిక పంపండి',
      'Get a phone notification for new notices, homework, absence, fee reminders and new photos.': 'కొత్త నోటీసులు, హోంవర్క్, గైర్హాజరు, ఫీజు గుర్తుచేత మరియు కొత్త ఫోటోలకు ఫోన్ నోటిఫికేషన్ పొందండి.',
      'Alerts are on for this phone ✓': 'ఈ ఫోన్‌కు హెచ్చరికలు ఆన్‌లో ఉన్నాయి ✓', 'Alerts are off on this phone.': 'ఈ ఫోన్‌లో హెచ్చరికలు ఆఫ్‌లో ఉన్నాయి.',
      'iPhone: alerts work only after you add this app to the Home Screen (Share → Add to Home Screen) and open it from there.': 'ఐఫోన్: ఈ యాప్‌ను హోమ్ స్క్రీన్‌కు జోడించి (Share → Add to Home Screen) అక్కడి నుండి తెరిచిన తర్వాతే హెచ్చరికలు పనిచేస్తాయి.',
      'This browser cannot show alerts. Try Chrome on Android, or install the app on iPhone.': 'ఈ బ్రౌజర్ హెచ్చరికలు చూపలేదు. ఆండ్రాయిడ్‌లో Chrome వాడండి లేదా ఐఫోన్‌లో యాప్ ఇన్‌స్టాల్ చేయండి.',
      'Alerts are not set up by the school yet.': 'పాఠశాల ఇంకా హెచ్చరికలను సెటప్ చేయలేదు.',
      'Notifications are blocked. Allow them in your phone settings for this app, then try again.': 'నోటిఫికేషన్‌లు బ్లాక్ అయ్యాయి. ఫోన్ సెట్టింగ్స్‌లో ఈ యాప్‌కు అనుమతించి మళ్ళీ ప్రయత్నించండి.',
      'Alerts turned on 🔔': 'హెచ్చరికలు ఆన్ అయ్యాయి 🔔', 'Alerts turned off': 'హెచ్చరికలు ఆఫ్ అయ్యాయి', 'Test alert sent': 'పరీక్ష హెచ్చరిక పంపబడింది',
      'Could not turn on alerts. Please try again.': 'హెచ్చరికలు ఆన్ కాలేదు. మళ్ళీ ప్రయత్నించండి.', 'Please wait a minute and try again.': 'ఒక నిమిషం ఆగి మళ్ళీ ప్రయత్నించండి.',
      'Language saved': 'భాష సేవ్ అయింది', 'Choose the app language. It is saved on this phone.': 'యాప్ భాషను ఎంచుకోండి. ఇది ఈ ఫోన్‌లో సేవ్ అవుతుంది.',
      'Not found.': 'కనిపించలేదు.', 'Connect to the internet to see this.': 'ఇది చూడటానికి ఇంటర్నెట్‌కు కనెక్ట్ చేయండి.'
    },
    hi: {
      'You have unsaved changes': 'आपके बदलाव अभी सेव नहीं हुए हैं', 'Send your message before you leave?': 'जाने से पहले अपना संदेश भेजें?', 'Keep editing': 'बदलाव जारी रखें', 'Discard': 'छोड़ दें',
      'Little Wings Parents': 'लिटिल विंग्स पेरेंट्स',
      'Welcome! See your child’s attendance, homework, fee receipts and school notices.': 'स्वागत है! अपने बच्चे की हाज़िरी, होमवर्क, फ़ीस रसीदें और स्कूल की सूचनाएँ यहाँ देखें।',
      'Mobile number': 'मोबाइल नंबर', 'Password': 'पासवर्ड', 'Sign in': 'साइन इन', 'Signing in…': 'साइन इन हो रहा है…',
      'Forgot password?': 'पासवर्ड भूल गए?', 'Please ask the school office:': 'कृपया स्कूल कार्यालय से पूछें:',
      'Enter your 10-digit mobile number': 'अपना 10 अंकों का मोबाइल नंबर डालें', 'Enter your password': 'अपना पासवर्ड डालें',
      'Wrong mobile number or password.': 'मोबाइल नंबर या पासवर्ड गलत है।', 'No internet. Please try again.': 'इंटरनेट नहीं है। फिर से कोशिश करें।',
      'Too many tries. Please wait a few minutes.': 'बहुत बार कोशिश हुई। कुछ मिनट रुकें।',
      'Your login shows only your own child’s details.': 'आपके लॉगिन में सिर्फ़ आपके बच्चे की जानकारी दिखती है।',
      'Show password': 'पासवर्ड दिखाएँ', 'Hide password': 'पासवर्ड छिपाएँ',
      'Install app': 'ऐप इंस्टॉल करें', 'Install this app on your phone': 'यह ऐप अपने फ़ोन पर इंस्टॉल करें',
      'iPhone (Safari):': 'आईफ़ोन (Safari):', 'tap Share (square with arrow ⬆️) → Add to Home Screen → Add.': 'Share (⬆️ तीर वाला चौकोर) → Add to Home Screen → Add दबाएँ।',
      'Android (Chrome):': 'एंड्रॉयड (Chrome):', 'tap ⋮ (menu) → Install app or Add to Home screen.': '⋮ (मेनू) → Install app या Add to Home screen दबाएँ।',
      'Loading…': 'लोड हो रहा है…', 'Loading your child’s details…': 'आपके बच्चे की जानकारी लोड हो रही है…',
      'You have signed out. Your child’s details were removed from this phone.': 'आप साइन आउट हो गए। बच्चे की जानकारी इस फ़ोन से हटा दी गई।',
      'This login is not a parent login. Staff please use the school dashboard.': 'यह अभिभावक लॉगिन नहीं है। स्टाफ़ स्कूल डैशबोर्ड इस्तेमाल करें।',
      'Your login was removed. Please contact the school office:': 'आपका लॉगिन हटा दिया गया है। कृपया स्कूल कार्यालय से संपर्क करें:',
      'Please sign in again.': 'कृपया फिर से साइन इन करें।', 'Your session ended. Please sign in again.': 'आपका सत्र समाप्त हो गया। कृपया फिर से साइन इन करें।',
      'Could not refresh. Pull down to try again.': 'रीफ़्रेश नहीं हो सका। फिर से कोशिश के लिए नीचे खींचें।',
      'You appear to be offline. Please connect to the internet and try again.': 'आप ऑफ़लाइन लगते हैं। इंटरनेट से जुड़कर फिर कोशिश करें।',
      'The app could not start. Check your internet connection and reload.': 'ऐप शुरू नहीं हो सका। इंटरनेट जाँचकर फिर से लोड करें।', 'Reload': 'फिर से लोड करें',
      'Refresh': 'रीफ़्रेश', 'My account': 'मेरा खाता', 'Choose child': 'बच्चा चुनें', 'Sec': 'सेक्शन', 'Inactive': 'निष्क्रिय',
      'You are offline. Showing what was saved': 'आप ऑफ़लाइन हैं। सेव की गई जानकारी दिखा रहे हैं', 'on {0}': '{0} को',
      'Present': 'उपस्थित', 'Absent': 'अनुपस्थित', 'Leave': 'छुट्टी', 'Half-day': 'आधा दिन',
      'Attendance': 'हाज़िरी', '{0} school days marked in {1}.': '{1} में {0} स्कूल दिन दर्ज हुए।', 'No attendance marked yet in {0}.': '{0} में अभी हाज़िरी दर्ज नहीं हुई।',
      'School': 'स्कूल', 'Class': 'कक्षा', 'Pinned': 'पिन किया गया', 'New': 'नया',
      'Class teacher': 'कक्षा शिक्षक', '{0} (class teacher)': '{0} (कक्षा शिक्षक)', 'School office': 'स्कूल कार्यालय',
      'Present today': 'आज उपस्थित', 'Absent today': 'आज अनुपस्थित', 'On leave today': 'आज छुट्टी पर', 'Half-day today': 'आज आधा दिन',
      '{0} — holiday': '{0} — छुट्टी', 'Sunday — holiday': 'रविवार — छुट्टी', 'Not marked yet': 'अभी दर्ज नहीं', 'Not loaded yet': 'अभी लोड नहीं हुआ',
      'the teacher usually marks attendance in the morning': 'शिक्षक आमतौर पर सुबह हाज़िरी लगाते हैं',
      'Today': 'आज', 'This month': 'इस महीने', 'Calendar': 'कैलेंडर', 'Latest notices': 'नई सूचनाएँ', 'See all': 'सभी देखें',
      'No notices right now.': 'अभी कोई सूचना नहीं।', 'Holidays & events': 'छुट्टियाँ और कार्यक्रम',
      'No upcoming holidays or events.': 'कोई आने वाली छुट्टी या कार्यक्रम नहीं।', 'Event (school open)': 'कार्यक्रम (स्कूल खुला)', 'Holiday': 'छुट्टी', 'Event': 'कार्यक्रम',
      'Sundays are always holidays.': 'रविवार को हमेशा छुट्टी रहती है।', 'Previous month': 'पिछला महीना', 'Next month': 'अगला महीना',
      'Sunday / holiday': 'रविवार / छुट्टी', 'Not marked': 'दर्ज नहीं', 'Upcoming': 'आने वाला', 'Summary': 'सारांश',
      'This month is not saved on the phone. Connect to the internet to see it.': 'यह महीना फ़ोन पर सेव नहीं है। देखने के लिए इंटरनेट से जुड़ें।',
      'Notices': 'सूचनाएँ', 'No notices right now. School and class notices will appear here.': 'अभी कोई सूचना नहीं। स्कूल और कक्षा की सूचनाएँ यहाँ दिखेंगी।',
      'Fees': 'फ़ीस', 'Fee summary': 'फ़ीस सारांश', 'Pending fees': 'बकाया फ़ीस', 'All paid ✓': 'सब जमा ✓',
      'Please pay at the school office. Ignore if already paid today.': 'कृपया स्कूल कार्यालय में जमा करें। आज जमा कर दी हो तो ध्यान न दें।',
      'No pending fees as of {0}. Thank you! 🙏': '{0} तक कोई बकाया नहीं। धन्यवाद! 🙏',
      'Monthly fee': 'मासिक फ़ीस', 'Paid ✓': 'जमा ✓', '{0} due': '{0} बकाया', 'Months paid': 'जमा किए महीने', '{0} of {1}': '{1} में से {0}',
      'Total paid': 'कुल जमा', 'Sibling discount': 'भाई-बहन छूट', 'Late fee included': 'विलंब शुल्क शामिल',
      'Van fee': 'वैन फ़ीस', '{0} / month (included above)': '{0} / महीना (ऊपर शामिल)', '/ month': '/ महीना',
      'Counted from {0} to {1}.': '{0} से {1} तक गिना गया।', 'The monthly fee is not set yet. Please contact the school office.': 'मासिक फ़ीस अभी तय नहीं है। कृपया कार्यालय से संपर्क करें।',
      'Payments & receipts': 'भुगतान और रसीदें', 'No payments recorded yet.': 'अभी कोई भुगतान दर्ज नहीं।', 'View / Print receipt': 'रसीद देखें / प्रिंट',
      'Saved {0}.': '{0} को सेव किया।', 'Questions about fees? Call': 'फ़ीस के बारे में सवाल? कॉल करें',
      'Fee details are not shown yet.': 'फ़ीस की जानकारी अभी नहीं दिखाई जा रही।', 'The school will turn this on soon. For any fee question, please call the school office:': 'स्कूल इसे जल्द चालू करेगा। फ़ीस के सवाल के लिए कार्यालय को कॉल करें:',
      'Fee details are not saved on this phone yet. Connect to the internet to see them.': 'फ़ीस की जानकारी इस फ़ोन पर अभी सेव नहीं है। देखने के लिए इंटरनेट से जुड़ें।',
      'Receipt': 'रसीद', 'Print / Save as PDF': 'प्रिंट / PDF सेव करें', 'Save image': 'इमेज सेव करें', 'Share on WhatsApp': 'व्हाट्सऐप पर भेजें',
      'To save a PDF: tap Print, then choose Save as PDF (iPhone: tap Share → Save to Files).': 'PDF सेव करने के लिए: Print दबाएँ, फिर Save as PDF चुनें (आईफ़ोन: Share → Save to Files)।',
      'Receipt image saved': 'रसीद की इमेज सेव हुई', 'Could not make the image': 'इमेज नहीं बन सकी', 'Close': 'बंद करें',
      'No child is linked to this login yet.': 'इस लॉगिन से अभी कोई बच्चा नहीं जुड़ा है।', 'Please contact the school office:': 'कृपया स्कूल कार्यालय से संपर्क करें:',
      'Home': 'होम', 'Updates': 'अपडेट', 'More': 'और', 'India time': 'भारतीय समय',
      'Change my password': 'मेरा पासवर्ड बदलें', 'New password (at least 8 characters)': 'नया पासवर्ड (कम से कम 8 अक्षर)', 'Confirm new password': 'नया पासवर्ड दोबारा डालें',
      'Save new password': 'नया पासवर्ड सेव करें', 'Use at least 8 characters': 'कम से कम 8 अक्षर रखें', 'Passwords do not match': 'पासवर्ड मेल नहीं खाते',
      'Choose a password different from the old one': 'पुराने से अलग पासवर्ड चुनें', 'Password changed 🔐': 'पासवर्ड बदल गया 🔐',
      'Need help or forgot your password? Call the school office:': 'मदद चाहिए या पासवर्ड भूल गए? स्कूल कार्यालय को कॉल करें:',
      'Sign out': 'साइन आउट', 'Signing out removes your child’s details from this phone.': 'साइन आउट करने पर बच्चे की जानकारी इस फ़ोन से हट जाएगी।', 'Parent': 'अभिभावक',
      'Updated ✓': 'अपडेट हुआ ✓', 'You are offline': 'आप ऑफ़लाइन हैं', 'App installed. Open it from your Home Screen.': 'ऐप इंस्टॉल हो गया। होम स्क्रीन से खोलें।',
      'New version available — tap to refresh': 'नया संस्करण उपलब्ध — रीफ़्रेश के लिए दबाएँ',
      'Language': 'भाषा', 'Homework & daily updates': 'होमवर्क और रोज़ के अपडेट', 'Homework': 'होमवर्क', 'What we learned': 'आज क्या सीखा', 'Meal': 'भोजन',
      'No updates yet. Homework and daily notes from the class teacher will appear here.': 'अभी कोई अपडेट नहीं। कक्षा शिक्षक का होमवर्क और रोज़ के नोट यहाँ दिखेंगे।',
      'Showing the last 30 days.': 'पिछले 30 दिन दिखा रहे हैं।', 'Latest updates': 'नए अपडेट', 'Yesterday': 'कल', 'Photo': 'फ़ोटो',
      'Timetable': 'समय-सारणी', 'No timetable yet. The class teacher will add it soon.': 'अभी समय-सारणी नहीं है। कक्षा शिक्षक जल्द जोड़ेंगे।',
      'Time': 'समय', 'Full week': 'पूरा सप्ताह',
      'Mon': 'सोम', 'Tue': 'मंगल', 'Wed': 'बुध', 'Thu': 'गुरु', 'Fri': 'शुक्र', 'Sat': 'शनि', 'Sun': 'रवि',
      'Report cards': 'रिपोर्ट कार्ड', 'Report card': 'रिपोर्ट कार्ड', 'No report cards yet. They appear here when the school publishes them.': 'अभी कोई रिपोर्ट कार्ड नहीं। स्कूल के प्रकाशित करने पर यहाँ दिखेंगे।',
      'Progress Report': 'प्रगति रिपोर्ट', 'Name': 'नाम', 'Subject': 'विषय', 'Marks': 'अंक', 'Grade': 'ग्रेड', 'Total': 'कुल', 'Remarks': 'टिप्पणी',
      'Grades: A+ 90%+ · A 75%+ · B 60%+ · C 45%+ · D below 45% · AB absent': 'ग्रेड: A+ 90%+ · A 75%+ · B 60%+ · C 45%+ · D 45% से कम · AB अनुपस्थित',
      'Principal': 'प्रधानाचार्य', 'Open': 'खोलें', 'Progress report': 'प्रगति रिपोर्ट',
      'Gallery': 'गैलरी', 'No photos yet. School and class albums will appear here.': 'अभी कोई फ़ोटो नहीं। स्कूल और कक्षा के एल्बम यहाँ दिखेंगे।',
      'Whole school': 'पूरा स्कूल', '{0} photos/videos': '{0} फ़ोटो/वीडियो', 'Back': 'वापस', 'Video': 'वीडियो', 'Album not found.': 'एल्बम नहीं मिला।',
      'Photos open only inside this app and links expire after an hour.': 'फ़ोटो सिर्फ़ इस ऐप में खुलती हैं; लिंक एक घंटे में समाप्त हो जाते हैं।',
      'Feedback': 'सुझाव', 'Message to the school': 'स्कूल को संदेश', 'Write your message, question or suggestion…': 'अपना संदेश, सवाल या सुझाव लिखें…',
      'Send': 'भेजें', 'Sending…': 'भेज रहे हैं…', 'Message sent. The school will reply here.': 'संदेश भेज दिया गया। स्कूल यहीं जवाब देगा।',
      'My messages': 'मेरे संदेश', 'No messages yet.': 'अभी कोई संदेश नहीं।', 'Seen': 'देखा गया', 'Replied': 'जवाब दिया', 'Sent': 'भेजा गया',
      'Reply from school': 'स्कूल का जवाब', 'About': 'बारे में', 'Please write at least 3 characters.': 'कम से कम 3 अक्षर लिखें।',
      'Please wait a minute before sending another message.': 'दूसरा संदेश भेजने से पहले एक मिनट रुकें।',
      'You can send up to 5 messages a day. Please call the school for anything urgent.': 'आप दिन में 5 संदेश तक भेज सकते हैं। ज़रूरी बात के लिए स्कूल को कॉल करें।',
      'Could not send. Please try again.': 'नहीं भेज सके। फिर से कोशिश करें।',
      'For urgent matters please call the school office.': 'ज़रूरी बातों के लिए कृपया स्कूल कार्यालय को कॉल करें।',
      'Alerts': 'अलर्ट', 'Turn on alerts': 'अलर्ट चालू करें', 'Turn off alerts': 'अलर्ट बंद करें', 'Send a test alert': 'टेस्ट अलर्ट भेजें',
      'Get a phone notification for new notices, homework, absence, fee reminders and new photos.': 'नई सूचनाओं, होमवर्क, अनुपस्थिति, फ़ीस याद दिलाने और नई फ़ोटो पर फ़ोन नोटिफ़िकेशन पाएँ।',
      'Alerts are on for this phone ✓': 'इस फ़ोन पर अलर्ट चालू हैं ✓', 'Alerts are off on this phone.': 'इस फ़ोन पर अलर्ट बंद हैं।',
      'iPhone: alerts work only after you add this app to the Home Screen (Share → Add to Home Screen) and open it from there.': 'आईफ़ोन: अलर्ट तभी काम करते हैं जब आप ऐप को होम स्क्रीन पर जोड़ें (Share → Add to Home Screen) और वहीं से खोलें।',
      'This browser cannot show alerts. Try Chrome on Android, or install the app on iPhone.': 'यह ब्राउज़र अलर्ट नहीं दिखा सकता। एंड्रॉयड पर Chrome आज़माएँ या आईफ़ोन पर ऐप इंस्टॉल करें।',
      'Alerts are not set up by the school yet.': 'स्कूल ने अभी अलर्ट सेट नहीं किए हैं।',
      'Notifications are blocked. Allow them in your phone settings for this app, then try again.': 'नोटिफ़िकेशन ब्लॉक हैं। फ़ोन सेटिंग में इस ऐप के लिए अनुमति दें, फिर कोशिश करें।',
      'Alerts turned on 🔔': 'अलर्ट चालू हुए 🔔', 'Alerts turned off': 'अलर्ट बंद हुए', 'Test alert sent': 'टेस्ट अलर्ट भेजा गया',
      'Could not turn on alerts. Please try again.': 'अलर्ट चालू नहीं हो सके। फिर कोशिश करें।', 'Please wait a minute and try again.': 'एक मिनट रुककर फिर कोशिश करें।',
      'Language saved': 'भाषा सेव हुई', 'Choose the app language. It is saved on this phone.': 'ऐप की भाषा चुनें। यह इस फ़ोन पर सेव रहती है।',
      'Not found.': 'नहीं मिला।', 'Connect to the internet to see this.': 'इसे देखने के लिए इंटरनेट से जुड़ें।'
    }
  };
  var LANGS = [['en', 'English'], ['te', 'తెలుగు'], ['hi', 'हिन्दी']];
  var LANG = (function () { if (!PART_B) return 'en'; try { var l = localStorage.getItem('lw-lang'); return l === 'te' || l === 'hi' ? l : 'en'; } catch (e) { return 'en'; } })();
  function t(s) {
    var r = (LANG !== 'en' && I18N[LANG] && I18N[LANG][s]) || s, a = arguments;
    return a.length > 1 ? r.replace(/\{(\d)\}/g, function (m, i) { var v = a[+i + 1]; return v == null ? '' : String(v); }) : r;
  }
  function locale() { return LANG === 'te' ? 'te-IN' : LANG === 'hi' ? 'hi-IN' : 'en-IN'; }

  /* ---------- small helpers ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var dparts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  function todayISO() { var p = {}; dparts.formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; }); return p.year + '-' + p.month + '-' + p.day; }
  function thisMonth() { return todayISO().slice(0, 7); }
  function addMonths(ym, n) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7) + n; y += Math.floor((m - 1) / 12); m = (((m - 1) % 12) + 12) % 12 + 1; return y + '-' + String(m).padStart(2, '0'); }
  function addDays(iso, n) { var d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n)); return d.toISOString().slice(0, 10); }
  function daysIn(ym) { return new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate(); }
  function weekday(iso) { return new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)).getDay(); }
  function localDate(iso) { return new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +(iso.slice(8, 10) || 1)); }
  function monthName(ym) { try { return localDate(ym + '-01').toLocaleDateString(locale(), { month: 'long', year: 'numeric' }); } catch (e) { return ym; } }
  function niceDate(iso) { try { return localDate(iso).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' }); } catch (e) { return iso; } }
  function shortDate(iso) { try { return localDate(iso).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' }); } catch (e) { return iso; } }
  function dayLabel(iso) { var td = todayISO(); return iso === td ? t('Today') : iso === addDays(td, -1) ? t('Yesterday') : shortDate(iso); }
  function stamp(iso) { try { return new Intl.DateTimeFormat(locale(), { timeZone: TZ, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)); } catch (e) { return ''; } }
  function normPhone(p) { var d = String(p || '').replace(/\D/g, ''); if (d.length === 12 && d.indexOf('91') === 0) d = d.slice(2); else if (d.length === 11 && d.charAt(0) === '0') d = d.slice(1); return d; }
  function fmtMobile(d) { return d && d.length === 10 ? d.slice(0, 5) + ' ' + d.slice(5) : d || ''; }
  function className(id) { return CLASSES[id] ? CLASSES[id].name : ''; }
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage full: ignore */ } }
  function isNetErr(e) { var m = (e && (e.message || e.details)) || String(e || ''); return navigator.onLine === false || /fetch|network|load failed|timeout|offline/i.test(m); }
  function toast(msg, type) {
    var root = $('#toast-root'); if (!root) return;
    var el = document.createElement('div'); el.className = 'toast ' + (type || ''); el.textContent = msg; root.appendChild(el);
    while (root.children.length > 2) root.removeChild(root.firstChild);
    setTimeout(function () { el.classList.add('out'); }, 2600); setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 3000);
  }
  function isStandalone() { return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true; }
  function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function linkify(s) { return esc(s).replace(/https?:\/\/[^\s<]+/g, function (u) { return '<a href="' + u + '" target="_blank" rel="noopener">' + u + '</a>'; }); }

  /* ---------- state ---------- */
  // S = { uid, name, phone, children:[], cur, month, att:{sid:{ym:{day:st}}}, fees:{sid:{enabled,sum,pays}}, notices:[], holidays:[],
  //       posts:{sid:[]}, tt:{sid:{d}}, rc:{sid:[]}, albums:[]|null, fb:[]|null, savedAt, error }
  var S = null;
  var tab = 'home', album = '', ttDay = -1, ttWeek = false, online = navigator.onLine !== false, loading = false, deferredInstall = null, channel = null, pollT = null, lastRefresh = 0;
  var inflight = {};

  function cacheKey() { return CACHE + S.uid; }
  function saveCache() {
    if (!S) return;
    var kids = (S.children || []).map(function (k) { return { id: k.id, name: k.name, classId: k.classId, section: k.section || '', status: k.status || 'Active', photoPath: k.photoPath || '' }; });
    lsSet(cacheKey(), { v: 3, name: S.name, phone: S.phone, children: kids, cur: S.cur, att: S.att, fees: S.fees, notices: S.notices, holidays: S.holidays || [],
      posts: S.posts, tt: S.tt, rc: S.rc, albums: S.albums, fb: S.fb, savedAt: S.savedAt });
  }
  function clearAllLocal() {
    try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf('lwp_') === 0) localStorage.removeItem(k); }); } catch (e) { /* ignore */ }
    URLS = {};
  }
  function child() { if (!S) return null; for (var i = 0; i < S.children.length; i++) if (S.children[i].id === S.cur) return S.children[i]; return S.children[0] || null; }
  function attFor(sid, ym) { return (S.att[sid] && S.att[sid][ym]) || null; }

  /* ---------- private photos: short-lived signed URLs (memory only) ---------- */
  var URLS = {};
  function surl(bucket, path) { var x = URLS[bucket + '|' + path]; return x && x.exp > Date.now() + 30000 ? x.u : ''; }
  function signPaths(bucket, paths) {
    var re = bucket === 'gallery' ? GALLERY_RE : bucket === 'class-media' ? CLASS_MEDIA_RE : /^[A-Za-z0-9_-]{1,64}\/photo\.jpg$/;
    var need = paths.filter(function (p, i) { return re.test(p) && !surl(bucket, p) && paths.indexOf(p) === i; });
    if (!need.length || !SB || !online) return Promise.resolve();
    var exp = Date.now() + 3500 * 1000;
    return SB.storage.from(bucket).createSignedUrls(need, 3600).then(function (r) {
      (r && r.data || []).forEach(function (x) { if (x && x.signedUrl && !x.error) URLS[bucket + '|' + x.path] = { u: x.signedUrl, exp: exp }; });
    }).catch(function () { /* show placeholders */ });
  }
  // After each render: fill in <img|video data-b data-p> with signed URLs.
  function hydrate() {
    var els = $$('[data-b][data-p]'), by = {};
    els.forEach(function (el) { var b = el.getAttribute('data-b'); (by[b] = by[b] || []).push(el.getAttribute('data-p')); });
    Object.keys(by).forEach(function (b) {
      signPaths(b, by[b]).then(function () {
        $$('[data-b="' + b + '"][data-p]').forEach(function (el) {
          var u = surl(b, el.getAttribute('data-p'));
          if (u && el.getAttribute('src') !== u) { el.setAttribute('src', u); el.classList.add('ready'); }
          else if (!u) el.classList.add('missing');
        });
      });
    });
  }
  function loadChildPhotos() {
    if (!S || !SB) return Promise.resolve();
    var paths = S.children.map(function (k) { return k.photoPath; }).filter(Boolean);
    return signPaths('student-photos', paths).then(function () { S.children.forEach(function (k) { k.photoUrl = k.photoPath ? surl('student-photos', k.photoPath) : ''; }); });
  }

  /* ---------- auth screens ---------- */
  function installHint() {
    if (isStandalone()) return '';
    return '<div class="install-hint"><p id="install-btn-wrap"' + (deferredInstall ? '' : ' hidden') + '><button type="button" class="btn sky block" data-act="install">📲 ' + esc(t('Install app')) + '</button></p>' +
      '<details><summary>📲 ' + esc(t('Install this app on your phone')) + '</summary><ol class="install-steps">' +
      '<li><b>' + esc(t('iPhone (Safari):')) + '</b> ' + esc(t('tap Share (square with arrow ⬆️) → Add to Home Screen → Add.')) + '</li>' +
      '<li><b>' + esc(t('Android (Chrome):')) + '</b> ' + esc(t('tap ⋮ (menu) → Install app or Add to Home screen.')) + '</li></ol></details></div>';
  }
  function langPicker(cls) {
    if (!PART_B) return '';
    return '<div class="lang-pick ' + (cls || '') + '" role="group" aria-label="Language">' + LANGS.map(function (l) {
      return '<button type="button" class="lang-btn' + (LANG === l[0] ? ' active' : '') + '" data-act="lang" data-lang="' + l[0] + '" lang="' + l[0] + '" aria-pressed="' + (LANG === l[0]) + '">' + esc(l[1]) + '</button>';
    }).join('') + '</div>';
  }
  var loginMsg = null;
  function showLogin(msg, isErr) {
    stopLive();
    S = null;
    loginMsg = { msg: msg, isErr: isErr };
    document.title = t('Little Wings Parents');
    $('#app').innerHTML = '<div class="auth-wrap"><div class="auth-card">' + langPicker('top') +
      '<img class="auth-logo" src="../assets/logo.jpeg" alt="The Little Wings Play School logo" width="104" height="104">' +
      '<h1>' + esc(t('Little Wings Parents')) + '</h1><p class="hello"><span class="telugu">నమస్తే 🙏</span> ' + esc(t('Welcome! See your child’s attendance, homework, fee receipts and school notices.')) + '</p>' +
      '<form id="login" novalidate>' +
      '<label class="field"><span class="lbl">' + esc(t('Mobile number')) + '</span><span class="tel-wrap"><span class="cc">+91</span><input name="mobile" type="tel" inputmode="numeric" autocomplete="username" maxlength="14" placeholder="98765 43210" value="' + esc(fmtMobile(lsGet('lwp_last') || '')) + '" required></span></label>' +
      '<label class="field"><span class="lbl">' + esc(t('Password')) + '</span><span class="pw-wrap"><input name="password" type="password" autocomplete="current-password" maxlength="72" required><button type="button" class="pw-toggle" data-act="pw" aria-label="' + esc(t('Show password')) + '">👁️</button></span></label>' +
      (msg ? '<p class="note ' + (isErr ? 'err-box' : '') + '">' + esc(msg) + '</p>' : '') +
      '<button class="btn primary block">' + esc(t('Sign in')) + '</button>' +
      '<p class="note warn small"><b>' + esc(t('Forgot password?')) + '</b> ' + esc(t('Please ask the school office:')) + ' <a href="' + OFFICE_TEL + '">' + OFFICE + '</a>.</p>' +
      '</form>' + installHint() + '</div><p class="auth-foot">🔐 ' + esc(t('Your login shows only your own child’s details.')) + ' · The Little Wings Play School, Vuyyuru · v' + VERSION + '</p></div>';
    var f = $('#login');
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      $$('.err', f).forEach(function (x) { x.remove(); }); $$('.invalid', f).forEach(function (x) { x.classList.remove('invalid'); });
      var mob = normPhone(f.mobile.value), pw = f.password.value;
      if (!/^[6-9]\d{9}$/.test(mob)) return fieldErr(f, 'mobile', t('Enter your 10-digit mobile number'));
      if (!pw) return fieldErr(f, 'password', t('Enter your password'));
      var btn = $('button.primary', f); btn.disabled = true; btn.textContent = t('Signing in…');
      SB.auth.signInWithPassword({ email: mob + '@' + DOMAIN, password: pw }).then(function (r) {
        btn.disabled = false; btn.textContent = t('Sign in');
        if (r.error) {
          f.password.value = '';
          var m = r.error.message || '';
          return fieldErr(f, 'password', /invalid login/i.test(m) ? t('Wrong mobile number or password.') : /fetch|network/i.test(m) ? t('No internet. Please try again.') : /rate|too many/i.test(m) ? t('Too many tries. Please wait a few minutes.') : m);
        }
        lsSet('lwp_last', mob);
        start(r.data.session.user);
      }).catch(function (err) { btn.disabled = false; btn.textContent = t('Sign in'); fieldErr(f, 'password', isNetErr(err) ? t('No internet. Please try again.') : err.message); });
    });
  }
  function fieldErr(f, name, msg) {
    var inp = f.querySelector('[name="' + name + '"]'), wrap = inp.closest('.field');
    wrap.classList.add('invalid');
    var s = document.createElement('small'); s.className = 'err'; s.textContent = msg; wrap.appendChild(s);
    inp.focus();
  }
  function showLoading(msg) {
    $('#app').innerHTML = '<div class="auth-wrap"><div class="auth-card center"><img class="auth-logo" src="../assets/logo.jpeg" alt="" width="104" height="104"><h1>' + esc(t('Little Wings Parents')) + '</h1><p class="hello">' + esc(msg || t('Loading…')) + '</p><div class="spinner"></div></div></div>';
  }

  /* ---------- session ---------- */
  function start(user) {
    var email = user.email || '';
    S = { uid: user.id, name: '', phone: email.split('@')[1] === DOMAIN ? email.split('@')[0] : '', children: [], cur: '', month: thisMonth(), att: {}, fees: {}, notices: [], holidays: [],
      posts: {}, tt: {}, rc: {}, albums: null, fb: null, savedAt: null, error: '' };
    // Language saved with the login is used on a new phone (this phone's choice wins).
    var ml = user.user_metadata && user.user_metadata.lw_lang;
    if (PART_B && !localStorage.getItem('lw-lang') && (ml === 'te' || ml === 'hi') && ml !== LANG) applyLang(ml, false);
    var c = lsGet(cacheKey());
    if (c && (c.v === 1 || c.v === 2 || c.v === 3)) {
      S.name = c.name || ''; S.children = Array.isArray(c.children) ? c.children : []; S.cur = c.cur || '';
      S.att = c.att && typeof c.att === 'object' ? c.att : {}; S.fees = c.fees && typeof c.fees === 'object' ? c.fees : {}; S.notices = arr(c.notices); S.holidays = arr(c.holidays); S.savedAt = c.savedAt || null;
      if (c.v === 3) {
        S.posts = c.posts && typeof c.posts === 'object' ? c.posts : {}; S.tt = c.tt && typeof c.tt === 'object' ? c.tt : {}; S.rc = c.rc && typeof c.rc === 'object' ? c.rc : {};
        S.albums = Array.isArray(c.albums) ? c.albums : null; S.fb = Array.isArray(c.fb) ? c.fb : null;
      }
    }
    if (S.children.length) render(); else showLoading(t('Loading your child’s details…'));
    startLive();
    refresh(true);
    pushSync();
  }
  function signOut(msg, isErr) {
    stopLive();
    closeSheet();
    var uidWas = S && S.uid;
    // Stop this phone getting the child's alerts after sign-out.
    var p = pushDrop().catch(function () {});
    clearAllLocal();
    var done = function () { showLogin(msg || t('You have signed out. Your child’s details were removed from this phone.'), isErr); };
    p.then(function () { return SB ? SB.auth.signOut({ scope: 'local' }).catch(function () {}) : null; }).then(done);
    return uidWas;
  }

  function rpcAttendance(sid, ym) {
    return SB.rpc('parent_attendance', { p_student: sid, p_from: ym + '-01', p_to: ym + '-' + String(daysIn(ym)).padStart(2, '0') }).then(function (r) {
      if (r.error) throw r.error;
      var m = {}; (r.data || []).forEach(function (x) { if (ST[x.status]) m[String(x.day).slice(0, 10)] = x.status; });
      S.att[sid] = S.att[sid] || {}; S.att[sid][ym] = m;
    });
  }
  // Fees: only through the parent_fees / parent_payments RPCs. The database
  // returns the signed-in parent's own child only, and nothing at all unless
  // the school switched on "Show fees to parents".
  function rpcFees(sid) {
    return Promise.all([SB.rpc('parent_fees', { p_student: sid }), SB.rpc('parent_payments', { p_student: sid })]).then(function (r) {
      if (r[0].error) throw r[0].error;
      if (r[1].error) throw r[1].error;
      var sum = (r[0].data || [])[0] || null;
      if (!sum || !sum.enabled) { if (sum && !sum.enabled) S.fees = {}; S.fees[sid] = { enabled: false, at: new Date().toISOString() }; return; }
      S.fees[sid] = { enabled: true, sum: sum, pays: r[1].data || [], at: new Date().toISOString() };
    });
  }
  function loadHolidays() {
    return SB.rpc('parent_holidays').then(function (r) {
      if (r.error) throw r.error;
      S.holidays = (r.data || []).map(function (h) { return { id: h.id, from: String(h.date_from || '').slice(0, 10), to: String(h.date_to || h.date_from || '').slice(0, 10), title: h.title || 'Holiday', kind: h.kind === 'Event' ? 'Event' : 'Holiday' }; });
    }).catch(function (e) { if (isNetErr(e)) throw e; });
  }
  function loadNotices() {
    return SB.from('notices').select('id,title,body,audience,pinned,expires_on,author_name,author_role,created_at')
      .order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(100).then(function (r) {
        if (r.error) throw r.error;
        S.notices = r.data || [];
      });
  }
  // Batch 2 data (all read through parent-only RPCs).
  function soft(p) { return p.catch(function (e) { if (isNetErr(e)) throw e; console.warn(e); }); }
  function loadPosts(sid) {
    return soft(SB.rpc('parent_posts', { p_student: sid, p_days: 30 }).then(function (r) {
      if (r.error) throw r.error;
      S.posts[sid] = (r.data || []).map(function (p) { return { id: p.id, day: p.day, kind: KINDS[p.kind] ? p.kind : 'Homework', title: p.title || '', body: p.body || '', photo: CLASS_MEDIA_RE.test(p.photo || '') ? p.photo : '', author: p.author || '', at: p.updated_at }; });
    }));
  }
  function loadTimetable(sid) {
    return soft(SB.rpc('parent_timetable', { p_student: sid }).then(function (r) {
      if (r.error) throw r.error;
      S.tt[sid] = { d: r.data && typeof r.data === 'object' ? r.data : null, at: new Date().toISOString() };
    }));
  }
  function loadReports(sid) {
    return soft(SB.rpc('parent_report_cards', { p_student: sid }).then(function (r) {
      if (r.error) throw r.error;
      S.rc[sid] = (r.data || []).map(function (x) { return { id: x.exam_id, exam: x.exam || {}, marks: x.marks || {}, remarks: x.remarks || '', classId: x.class_id }; });
    }));
  }
  function loadAlbums() {
    return soft(SB.rpc('parent_albums').then(function (r) {
      if (r.error) throw r.error;
      S.albums = (r.data || []).map(function (a) {
        return { id: a.id, classId: a.class_id || '', title: a.title || 'Album', day: a.day || '', items: arr(a.items).filter(function (i) { return i && GALLERY_RE.test(i.path || ''); }).map(function (i) { return { id: i.id, path: i.path, type: /\.(mp4|webm|mov)$/.test(i.path) ? 'video' : 'photo', name: i.name || '' }; }) };
      });
    }));
  }
  function loadFeedback() {
    return soft(SB.rpc('parent_feedback_list').then(function (r) {
      if (r.error) throw r.error;
      S.fb = r.data || [];
    }));
  }
  // What each screen needs (loaded when it is opened, refreshed with the 🔄 button).
  function needFor(tb) {
    var k = child();
    if (tb === 'updates' || tb === 'home') return k ? ['posts:' + k.id, function () { return loadPosts(k.id); }] : null;
    if (tb === 'timetable') return k ? ['tt:' + k.id, function () { return loadTimetable(k.id); }] : null;
    if (tb === 'reports') return k ? ['rc:' + k.id, function () { return loadReports(k.id); }] : null;
    if (tb === 'gallery') return ['albums', loadAlbums];
    if (tb === 'feedback') return ['fb', loadFeedback];
    return null;
  }
  function has(key) {
    var p = key.split(':');
    return p[0] === 'posts' ? !!S.posts[p[1]] : p[0] === 'tt' ? !!S.tt[p[1]] : p[0] === 'rc' ? !!S.rc[p[1]] : p[0] === 'albums' ? !!S.albums : p[0] === 'fb' ? !!S.fb : true;
  }
  function ensure(tb, force) {
    var n = needFor(tb);
    if (!n || !S || !online || inflight[n[0]]) return;
    if (!force && has(n[0]) && inflight[n[0] + ':done']) return;
    inflight[n[0]] = true;
    n[1]().then(function () { inflight[n[0]] = false; inflight[n[0] + ':done'] = true; saveCache(); if (S) render(); })
      .catch(function (e) { inflight[n[0]] = false; if (isNetErr(e)) { online = false; render(); } });
  }
  function refresh(full) {
    if (!S || !SB) return Promise.resolve();
    if (navigator.onLine === false) { online = false; render(); return Promise.resolve(); }
    if (loading) return Promise.resolve();
    loading = true; lastRefresh = Date.now();
    var uid = S.uid;
    var p = full ? SB.from('profiles').select('role,name').eq('id', uid).maybeSingle().then(function (r) {
      if (r.error) throw r.error;
      if (!r.data || r.data.role !== 'parent') { var e = new Error('not-parent'); e.notParent = !!r.data; e.noAccess = true; throw e; }
      S.name = r.data.name || S.name;
      return SB.rpc('parent_children');
    }).then(function (r) {
      if (r.error) throw r.error;
      S.children = (r.data || []).map(function (k) {
        return { id: k.id, name: k.name, classId: k.class_id, section: k.section || '', status: k.status || 'Active', photoPath: k.photo_path || '', photoUrl: '' };
      });
      if (!S.children.some(function (k) { return k.id === S.cur; })) S.cur = S.children[0] ? S.children[0].id : '';
      return loadChildPhotos();
    }) : Promise.resolve();
    return p.then(function () {
      var jobs = [loadNotices(), loadHolidays()];
      var k = child();
      if (k) {
        jobs.push(rpcAttendance(k.id, thisMonth()));
        jobs.push(rpcFees(k.id));
        jobs.push(loadPosts(k.id));
        if (S.month !== thisMonth()) jobs.push(rpcAttendance(k.id, S.month));
      }
      var n = needFor(tab);
      if (n && n[0].indexOf('posts:') !== 0) jobs.push(n[1]().then(function () { inflight[n[0] + ':done'] = true; }));
      return Promise.all(jobs);
    }).then(function () {
      if (!S || S.uid !== uid) return;
      online = true; S.error = ''; S.savedAt = new Date().toISOString();
      if (child()) inflight['posts:' + child().id + ':done'] = true;
      saveCache(); loading = false; render();
    }).catch(function (e) {
      loading = false;
      if (!S || S.uid !== uid) return;
      if (e && e.noAccess) { signOut(e.notParent ? t('This login is not a parent login. Staff please use the school dashboard.') : t('Your login was removed. Please contact the school office:') + ' ' + OFFICE + '.', true); return; }
      if (e && (e.status === 401 || /jwt|token/i.test(e.message || ''))) { signOut(t('Please sign in again.'), true); return; }
      if (isNetErr(e)) online = false; else S.error = t('Could not refresh. Pull down to try again.');
      render();
    });
  }
  function startLive() {
    stopLive();
    try {
      channel = SB.channel('lwp-notices-' + S.uid)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'notices' }, function () { setTimeout(function () { if (S) loadNotices().then(function () { saveCache(); render(); }).catch(function () {}); }, 600); })
        .subscribe();
    } catch (e) { /* polling below still works */ }
    pollT = setInterval(function () { if (S && document.visibilityState !== 'hidden' && Date.now() - lastRefresh > 55000) refresh(false); }, 60000);
  }
  function stopLive() {
    if (channel && SB) { try { SB.removeChannel(channel); } catch (e) { /* ignore */ } }
    channel = null; clearInterval(pollT); pollT = null;
  }

  /* ---------- views ---------- */
  function seenAt() { return (S && lsGet(SEEN + S.uid)) || ''; }
  function newCount() { var t0 = seenAt(); return S.notices.filter(function (n) { return !t0 || n.created_at > t0; }).length; }
  function postsOf() { var k = child(); return (k && S.posts[k.id]) || null; }
  function newPosts() { var k = child(), l = postsOf(); if (!l || !k) return 0; var s = lsGet(SEENP + S.uid + '_' + k.id) || ''; return l.filter(function (p) { return !s || String(p.at || '') > s; }).length; }
  function header() {
    var k = child();
    var sub = k ? (CLASSES[k.classId] ? CLASSES[k.classId].emoji + ' ' : '') + className(k.classId) + (k.section ? ' · ' + t('Sec') + ' ' + k.section : '') + (k.status === 'Inactive' ? ' · ' + t('Inactive') : '') + ' · The Little Wings' : 'The Little Wings Play School';
    var face = (k && k.photoUrl) ? '<img class="kid-photo" src="' + esc(k.photoUrl) + '" alt="" width="42" height="42">' : '<img src="../assets/logo.jpeg" alt="" width="42" height="42">';
    var html = '<header class="top"><div class="top-row">' + face + '<div class="top-title"><b>' + esc(k ? k.name : t('Little Wings Parents')) + '</b><small>' + esc(sub) + '</small></div>' +
      '<button class="icon-btn" data-act="refresh" aria-label="' + esc(t('Refresh')) + '" title="' + esc(t('Refresh')) + '">' + (loading ? '⏳' : '🔄') + '</button><button class="icon-btn" data-act="account" aria-label="' + esc(t('My account')) + '" title="' + esc(t('My account')) + '">👤</button></div>';
    if (S.children.length > 1) html += '<div class="kid-switch" role="tablist" aria-label="' + esc(t('Choose child')) + '">' + S.children.map(function (c) { return '<button class="kid-chip' + (c.id === S.cur ? ' active' : '') + '" data-act="kid" data-id="' + esc(c.id) + '" role="tab" aria-selected="' + (c.id === S.cur) + '">' + esc(c.name) + '</button>'; }).join('') + '</div>';
    html += '</header>';
    if (!online) html += '<div class="banner offline">📴 ' + esc(t('You are offline. Showing what was saved')) + (S.savedAt ? ' ' + esc(t('on {0}', stamp(S.savedAt))) : '') + '.</div>';
    else if (S.error) html += '<div class="banner error">' + esc(S.error) + '</div>';
    return html;
  }
  function counts(m, ym) {
    var c = { P: 0, A: 0, L: 0, H: 0, marked: 0, pct: null };
    Object.keys(m || {}).forEach(function (d) { if (d.slice(0, 7) === ym && ST[m[d]]) { c[m[d]]++; c.marked++; } });
    if (c.marked) c.pct = Math.round((c.P + 0.5 * c.H) / c.marked * 100);
    return c;
  }
  function summaryHTML(m, ym) {
    var c = counts(m, ym);
    return '<div class="sum-grid">' + ['P', 'A', 'L', 'H'].map(function (s) { return '<div class="sum ' + ST[s].cls + '"><b>' + c[s] + '</b><span>' + esc(t(ST[s].label)) + '</span></div>'; }).join('') + '</div>' +
      '<div class="pct"><div class="pct-row"><span>' + esc(t('Attendance')) + '</span><span>' + (c.pct == null ? '—' : c.pct + '%') + '</span></div><div class="pct-bar"><i style="width:' + (c.pct || 0) + '%"></i></div>' +
      '<p class="muted small">' + esc(c.marked ? t('{0} school days marked in {1}.', c.marked, monthName(ym)) : t('No attendance marked yet in {0}.', monthName(ym))) + '</p></div>';
  }
  function holidayOn(iso) { var l = (S && S.holidays) || []; for (var i = 0; i < l.length; i++) if (l[i].kind === 'Holiday' && iso >= l[i].from && iso <= l[i].to) return l[i]; return null; }
  function holRange(h) { return h.to && h.to !== h.from ? shortDate(h.from) + ' – ' + shortDate(h.to) : shortDate(h.from); }
  function holidaysHTML(limit) {
    var today = todayISO(), l = ((S && S.holidays) || []).filter(function (h) { return h.to >= today; });
    if (limit) l = l.slice(0, limit);
    if (!l.length) return '<p class="muted">' + esc(t('No upcoming holidays or events.')) + '</p>';
    return '<ul class="hol-list">' + l.map(function (h) {
      return '<li class="' + (h.kind === 'Event' ? 'ev' : 'off') + '"><span class="hi">' + (h.kind === 'Event' ? '📌' : '🎉') + '</span><span><b>' + esc(h.title) + '</b><small>' + esc(holRange(h)) + ' · ' + esc(h.kind === 'Event' ? t('Event (school open)') : t('Holiday')) + '</small></span></li>';
    }).join('') + '</ul>';
  }
  function noticeHTML(n, isNew) {
    var tag = n.audience === 'all' ? '<span class="tag school">🏫 ' + esc(t('School')) + '</span>' : '<span class="tag cls" style="--c:' + esc((CLASSES[n.audience] || {}).color || '#38a8e0') + '">' + esc((CLASSES[n.audience] || {}).emoji || '') + ' ' + esc(className(n.audience) || t('Class')) + '</span>';
    return '<article class="notice' + (n.pinned ? ' pinned' : '') + '"><div class="tags">' + tag + (n.pinned ? '<span class="tag pin">📌 ' + esc(t('Pinned')) + '</span>' : '') + (isNew ? '<span class="tag new">' + esc(t('New')) + '</span>' : '') + '</div>' +
      '<h3>' + esc(n.title) + '</h3>' + (n.body ? '<p class="body">' + linkify(n.body) + '</p>' : '') +
      '<p class="meta">' + esc(n.author_role === 'teacher' ? (n.author_name ? t('{0} (class teacher)', n.author_name) : t('Class teacher')) : t('School office')) + ' · ' + esc(stamp(n.created_at)) + '</p></article>';
  }
  function postHTML(p) {
    var k = KINDS[p.kind] || KINDS.Homework;
    return '<article class="post k-' + esc(p.kind.toLowerCase()) + '"><div class="tags"><span class="tag kind">' + k.emoji + ' ' + esc(t(k.label)) + '</span></div>' +
      (p.title ? '<h3>' + esc(p.title) + '</h3>' : '') + (p.body ? '<p class="body">' + linkify(p.body) + '</p>' : '') +
      (p.photo ? '<button type="button" class="post-photo" data-act="photo" data-b="class-media" data-path="' + esc(p.photo) + '" aria-label="' + esc(t('Photo')) + '"><img alt="" data-b="class-media" data-p="' + esc(p.photo) + '" loading="lazy"></button>' : '') +
      (p.author ? '<p class="meta">' + esc(p.author) + '</p>' : '') + '</article>';
  }
  function tile(tb, icon, label, extra) { return '<button class="tile" data-act="tab" data-tab="' + tb + '"><span class="ti">' + icon + '</span><span>' + esc(t(label)) + '</span>' + (extra || '') + '</button>'; }
  function tilesHTML() {
    return '<div class="tiles">' + tile('updates', '📚', 'Updates', newPosts() ? '<i class="dot">' + Math.min(newPosts(), 9) + '</i>' : '') + tile('timetable', '🗓️', 'Timetable') + tile('reports', '📄', 'Report cards') +
      tile('gallery', '📸', 'Gallery') + tile('fees', '💰', 'Fees') + tile('feedback', '💬', 'Feedback') + '</div>';
  }
  function viewHome() {
    var k = child(), today = todayISO(), ym = thisMonth();
    if (!k) return noChild();
    var m = attFor(k.id, ym), st = m ? m[today] : null, hol = holidayOn(today), sun = weekday(today) === 0 || !!hol;
    var tcls = st ? ST[st].cls : sun ? 'hol' : '', icon = st ? ST[st].emoji : sun ? '🎈' : '🕘';
    var ttxt = st ? t(st === 'P' ? 'Present today' : st === 'A' ? 'Absent today' : st === 'L' ? 'On leave today' : 'Half-day today') : hol ? t('{0} — holiday', hol.title) : sun ? t('Sunday — holiday') : (m ? t('Not marked yet') : t('Not loaded yet'));
    var first = (S.name || '').split(' ')[0];
    var html = '<p class="greet"><span class="telugu">నమస్తే</span> ' + (first ? esc(first) + ' garu' : '') + ' 🙏</p>' +
      '<section class="card"><h2>' + esc(t('Today')) + ' · ' + esc(niceDate(today)) + '</h2><div class="today ' + tcls + '"><div class="big" aria-hidden="true">' + icon + '</div><div><b>' + esc(ttxt) + '</b><small>' + esc(k.name) + (st || sun ? '' : ' · ' + esc(t('the teacher usually marks attendance in the morning'))) + '</small></div></div></section>' +
      tilesHTML();
    var posts = postsOf();
    if (posts && posts.length) html += '<section class="card"><div class="row between"><h2>📚 ' + esc(t('Latest updates')) + '</h2><button class="btn small ghost" data-act="tab" data-tab="updates">' + esc(t('See all')) + '</button></div>' +
      '<p class="muted small">' + esc(dayLabel(posts[0].day)) + '</p>' + posts.filter(function (p) { return p.day === posts[0].day; }).slice(0, 3).map(postHTML).join('') + '</section>';
    html += '<section class="card"><div class="row between"><h2>' + esc(t('This month')) + '</h2><button class="btn small ghost" data-act="tab" data-tab="calendar">📅 ' + esc(t('Calendar')) + '</button></div>' + (m ? summaryHTML(m, ym) : '<div class="spinner"></div>') + '</section>';
    var list = S.notices.slice(0, 3), t0 = seenAt();
    html += '<section class="card"><div class="row between"><h2>📢 ' + esc(t('Latest notices')) + '</h2>' + (S.notices.length ? '<button class="btn small ghost" data-act="tab" data-tab="notices">' + esc(t('See all')) + '</button>' : '') + '</div>' +
      (list.length ? list.map(function (n) { return noticeHTML(n, !t0 || n.created_at > t0); }).join('') : '<p class="muted">' + esc(t('No notices right now.')) + '</p>') + '</section>';
    html += '<section class="card"><div class="row between"><h2>🗓️ ' + esc(t('Holidays & events')) + '</h2>' + ((S.holidays || []).length ? '<button class="btn small ghost" data-act="tab" data-tab="notices">' + esc(t('See all')) + '</button>' : '') + '</div>' + holidaysHTML(3) + '</section>';
    if (PART_B && !PUSH.on && !lsGet('lwp_alert_hide')) html += '<section class="card alert-card"><div class="row between"><h2>🔔 ' + esc(t('Alerts')) + '</h2><button class="icon-btn small" data-act="alert-hide" aria-label="' + esc(t('Close')) + '">✕</button></div><p class="small">' + esc(t('Get a phone notification for new notices, homework, absence, fee reminders and new photos.')) + '</p><button class="btn sky block" data-act="tab" data-tab="alerts">🔔 ' + esc(t('Turn on alerts')) + '</button></section>';
    if (!isStandalone()) html += '<section class="card">' + installHint().replace('class="install-hint"', 'class="install-hint" style="margin:0"') + '</section>';
    return html;
  }
  function viewCalendar() {
    var k = child();
    if (!k) return noChild();
    var ym = S.month, m = attFor(k.id, ym), today = todayISO(), n = daysIn(ym), lead = weekday(ym + '-01');
    if (!m && online) { setTimeout(function () { rpcAttendance(k.id, ym).then(function () { saveCache(); render(); }).catch(function (e) { if (isNetErr(e)) { online = false; render(); } }); }, 0); }
    var cells = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(function (d) { return '<div class="wd">' + esc(t(d)) + '</div>'; }).join('');
    for (var i = 0; i < lead; i++) cells += '<div class="d blank"></div>';
    for (var d = 1; d <= n; d++) {
      var iso = ym + '-' + String(d).padStart(2, '0'), s = m && m[iso], hd = holidayOn(iso), sun = weekday(iso) === 0 || !!hd;
      var cls = s ? ST[s].cls : sun ? 'hol' : iso > today ? 'fut' : '';
      var lbl = s ? t(ST[s].label) : hd ? hd.title : sun ? t('Holiday') : iso > today ? t('Upcoming') : t('Not marked');
      cells += '<div class="d ' + cls + (iso === today ? ' today' : '') + '" title="' + esc(niceDate(iso) + ': ' + lbl) + '" aria-label="' + esc(d + ' ' + lbl) + '">' + d + (s ? '<i>' + ST[s].short + '</i>' : '') + '</div>';
    }
    var min = addMonths(thisMonth(), -23);
    return '<section class="card"><div class="cal-nav"><button data-act="month" data-d="-1" aria-label="' + esc(t('Previous month')) + '"' + (ym <= min ? ' disabled' : '') + '>‹</button><h2>' + esc(monthName(ym)) + '</h2><button data-act="month" data-d="1" aria-label="' + esc(t('Next month')) + '"' + (ym >= thisMonth() ? ' disabled' : '') + '>›</button></div>' +
      (m ? '<div class="cal">' + cells + '</div>' : (online ? '<div class="spinner"></div>' : '<p class="note warn">' + esc(t('This month is not saved on the phone. Connect to the internet to see it.')) + '</p>')) +
      '<div class="legend"><span><i class="p"></i>' + esc(t('Present')) + '</span><span><i class="a"></i>' + esc(t('Absent')) + '</span><span><i class="l"></i>' + esc(t('Leave')) + '</span><span><i class="h"></i>' + esc(t('Half-day')) + '</span><span><i class="hol"></i>' + esc(t('Sunday / holiday')) + '</span><span><i></i>' + esc(t('Not marked')) + '</span></div></section>' +
      (m ? '<section class="card"><h2>' + esc(t('Summary')) + ' · ' + esc(monthName(ym)) + '</h2>' + summaryHTML(m, ym) + '</section>' : '');
  }
  function viewUpdates() {
    var k = child();
    if (!k) return noChild();
    var l = postsOf();
    ensure('updates');
    var html = '<section class="card"><div class="row between"><h2>📚 ' + esc(t('Homework & daily updates')) + '</h2></div><p class="muted small">' + esc(className(k.classId)) + ' · ' + esc(t('Showing the last 30 days.')) + '</p></section>';
    if (!l) return html + (online ? '<div class="spinner"></div>' : '<p class="note warn">' + esc(t('Connect to the internet to see this.')) + '</p>');
    if (!l.length) return html + '<section class="card"><div class="empty"><div class="e">📚</div><p>' + esc(t('No updates yet. Homework and daily notes from the class teacher will appear here.')) + '</p></div></section>';
    var days = [];
    l.forEach(function (p) { if (days.indexOf(p.day) === -1) days.push(p.day); });
    html += days.map(function (d) {
      return '<section class="card"><h2 class="day-h">' + esc(dayLabel(d)) + (d === todayISO() || d === addDays(todayISO(), -1) ? ' <small class="muted">' + esc(shortDate(d)) + '</small>' : '') + '</h2>' + l.filter(function (p) { return p.day === d; }).map(postHTML).join('') + '</section>';
    }).join('');
    var newest = l.reduce(function (a, p) { return String(p.at || '') > a ? String(p.at) : a; }, '');
    setTimeout(function () { if (S && tab === 'updates' && newest) { lsSet(SEENP + S.uid + '_' + k.id, newest); updateNavDot(); } }, 1500);
    return html;
  }
  function viewNotices() {
    var t0 = seenAt();
    var html = '<section class="card"><div class="row between"><h2>📢 ' + esc(t('Notices')) + '</h2><button class="btn small ghost" data-act="refresh">🔄 ' + esc(t('Refresh')) + '</button></div>' +
      (S.notices.length ? S.notices.map(function (n) { return noticeHTML(n, !t0 || n.created_at > t0); }).join('') : '<div class="empty"><div class="e">📭</div><p>' + esc(t('No notices right now. School and class notices will appear here.')) + '</p></div>') + '</section>' +
      '<section class="card"><h2>🗓️ ' + esc(t('Holidays & events')) + '</h2>' + holidaysHTML(0) + '<p class="muted small">' + esc(t('Sundays are always holidays.')) + '</p></section>';
    if (S.notices.length && S.notices.some(function (n) { return !t0 || n.created_at > t0; })) {
      var newest = S.notices.reduce(function (a, n) { return n.created_at > a ? n.created_at : a; }, '');
      setTimeout(function () { if (S && tab === 'notices') { lsSet(SEEN + S.uid, newest); updateNavDot(); } }, 1500);
    }
    return html;
  }
  function viewMore() {
    return '<section class="card"><h2>➕ ' + esc(t('More')) + '</h2>' + '<div class="tiles">' + tile('fees', '💰', 'Fees') + tile('timetable', '🗓️', 'Timetable') + tile('reports', '📄', 'Report cards') +
      tile('gallery', '📸', 'Gallery') + tile('feedback', '💬', 'Feedback') + (PART_B ? tile('alerts', '🔔', 'Alerts', PUSH.on ? '<i class="ok">✓</i>' : '') : '') + '</div></section>' +
      (PART_B ? '<section class="card"><h2>🌐 ' + esc(t('Language')) + '</h2><p class="muted small">' + esc(t('Choose the app language. It is saved on this phone.')) + '</p>' + langPicker() + '</section>' : '') +
      '<section class="card"><button class="btn ghost block" data-act="account">👤 ' + esc(t('My account')) + '</button></section>';
  }
  function backBar(title) { return '<div class="back-bar"><button class="btn small ghost" data-act="tab" data-tab="more">← ' + esc(t('More')) + '</button><h2>' + title + '</h2></div>'; }

  /* fees */
  function inr(n) { return window.LWReceipt ? window.LWReceipt.inr(n) : '₹' + (Number(n) || 0); }
  function feeMonthName(ym) { return /^\d{4}-\d{2}$/.test(ym || '') ? monthName(ym) : ''; }
  function viewFees() {
    var k = child();
    if (!k) return noChild();
    var f = S.fees[k.id], head = backBar('💰 ' + esc(t('Fees')));
    if (!f) {
      if (online) { setTimeout(function () { if (S && !S.fees[k.id]) rpcFees(k.id).then(function () { saveCache(); render(); }).catch(function (e) { if (isNetErr(e)) { online = false; render(); } }); }, 0); return head + '<section class="card"><div class="spinner"></div></section>'; }
      return head + '<section class="card"><p class="note warn">' + esc(t('Fee details are not saved on this phone yet. Connect to the internet to see them.')) + '</p></section>';
    }
    if (!f.enabled) {
      return head + '<section class="card"><div class="empty"><div class="e">💰</div><p><b>' + esc(t('Fee details are not shown yet.')) + '</b><br>' + esc(t('The school will turn this on soon. For any fee question, please call the school office:')) + ' <a href="' + OFFICE_TEL + '">' + OFFICE + '</a>.</p></div></section>';
    }
    var m = f.sum, pays = f.pays || [], ym = thisMonth();
    var due = Number(m.total_due) || 0, nowDue = Number(m.this_month_due) || 0, fee = Number(m.monthly_fee) || 0, van = Number(m.van_fee) || 0;
    var html = head + '<section class="card"><h2>💰 ' + esc(t('Fee summary')) + '</h2>';
    if (fee > 0) {
      html += '<div class="fee-due ' + (due > 0 ? 'due' : 'ok') + '"><small>' + esc(due > 0 ? t('Pending fees') : t('Fees')) + '</small><b>' + (due > 0 ? esc(inr(due)) : esc(t('All paid ✓'))) + '</b>' +
        (due > 0 ? '<span>' + esc(t('Please pay at the school office. Ignore if already paid today.')) + '</span>' : '<span>' + esc(t('No pending fees as of {0}. Thank you! 🙏', feeMonthName(m.as_of_month) || monthName(ym))) + '</span>') + '</div>' +
        '<div class="kv-grid"><div><small>' + esc(t('Monthly fee')) + '</small><b>' + esc(inr(fee)) + '</b></div>' +
        (van > 0 ? '<div><small>🚐 ' + esc(t('Van fee')) + '</small><b>' + esc(inr(van)) + ' ' + esc(t('/ month')) + '</b></div>' : '') +
        '<div><small>' + esc(feeMonthName(m.as_of_month) || monthName(ym)) + '</small><b class="' + (nowDue > 0 ? 'coral-t' : 'green-t') + '">' + (nowDue > 0 ? esc(t('{0} due', inr(nowDue))) : esc(t('Paid ✓'))) + '</b></div>' +
        '<div><small>' + esc(t('Months paid')) + '</small><b>' + esc(t('{0} of {1}', Number(m.months_paid) || 0, Number(m.months_billed) || 0)) + '</b></div>' +
        '<div><small>' + esc(t('Total paid')) + '</small><b>' + esc(inr(m.total_paid)) + '</b></div>' +
        (Number(m.discount) > 0 ? '<div><small>' + esc(t('Sibling discount')) + '</small><b class="green-t">−' + esc(inr(m.discount)) + ' ' + esc(t('/ month')) + '</b></div>' : '') +
        (Number(m.late_fee) > 0 ? '<div><small>' + esc(t('Late fee included')) + '</small><b class="coral-t">' + esc(inr(m.late_fee)) + '</b></div>' : '') + '</div>' +
        (van > 0 ? '<p class="muted small">🚐 ' + esc(t('Van fee')) + ': ' + esc(t('{0} / month (included above)', inr(van))) + '</p>' : '') +
        (m.fees_from ? '<p class="muted small">' + esc(t('Counted from {0} to {1}.', feeMonthName(m.fees_from), feeMonthName(m.as_of_month))) + '</p>' : '');
    } else {
      html += '<p class="muted">' + esc(t('The monthly fee is not set yet. Please contact the school office.')) + '</p>';
    }
    html += '</section><section class="card"><h2>🧾 ' + esc(t('Payments & receipts')) + '</h2>';
    if (!pays.length) html += '<div class="empty"><div class="e">🧾</div><p>' + esc(t('No payments recorded yet.')) + '</p></div>';
    else html += '<ul class="pay-list">' + pays.map(function (p) {
      return '<li><div class="pay-main"><b>' + esc(inr(p.amount)) + '</b><span>' + esc(window.LWReceipt ? window.LWReceipt.period(p.months) : '') + '</span><small>' + esc(p.receipt_no) + ' · ' + esc(window.LWReceipt ? window.LWReceipt.fmtDate(p.paid_on) : p.paid_on) + ' · ' + esc(p.mode) + '</small></div>' +
        '<button class="btn small sky" data-act="receipt" data-id="' + esc(p.id) + '">🧾 ' + esc(t('View / Print receipt')) + '</button></li>';
    }).join('') + '</ul>';
    html += '<p class="muted small">' + esc(t('Saved {0}.', stamp(f.at))) + ' ' + esc(t('Questions about fees? Call')) + ' <a href="' + OFFICE_TEL + '">' + OFFICE + '</a>.</p></section>';
    return html;
  }
  function receiptFor(pid) {
    var k = child(), f = k && S.fees[k.id];
    if (!f || !f.enabled) return null;
    var p = (f.pays || []).filter(function (x) { return x.id === pid; })[0];
    if (!p) return null;
    var m = f.sum, snap = p.balance_after != null && isFinite(Number(p.balance_after));
    return {
      school: { name: m.school_name, address: m.school_address, phone: m.school_phone, email: m.school_email }, logo: '../assets/logo.jpeg',
      receiptNo: p.receipt_no, date: p.paid_on, studentName: p.student_name || k.name, className: className(p.class_id || k.classId), parentName: p.parent_name || m.parent_name || '',
      months: p.months || [], monthlyFee: p.monthly_fee != null ? p.monthly_fee : m.monthly_fee, vanFee: Number(p.van_fee) || 0, amount: p.amount, mode: p.mode, ref: p.ref,
      balance: snap ? Number(p.balance_after) : (Number(m.monthly_fee) > 0 ? Number(m.total_due) || 0 : null),
      balanceLabel: snap ? 'Balance due after this payment' : 'Balance due (as on ' + window.LWReceipt.fmtDate(todayISO()) + ')',
      receivedBy: p.received_by || ''
    };
  }
  function openReceipt(pid) {
    var r = receiptFor(pid);
    if (!r || !window.LWReceipt) return;
    $('#sheet-root').innerHTML = '<div class="sheet-bg" data-act="sheet-bg"><div class="sheet wide" id="rcpt-sheet" role="dialog" aria-modal="true" aria-label="' + esc(t('Receipt')) + '"><div class="sheet-head"><h2>🧾 ' + esc(t('Receipt')) + ' ' + esc(r.receiptNo) + '</h2><button class="icon-btn" data-act="sheet-close" aria-label="' + esc(t('Close')) + '">✕</button></div>' +
      '<div class="rcpt-preview">' + window.LWReceipt.html(r) + '</div>' +
      '<div class="rcpt-actions"><button class="btn primary" data-act="rcpt-print" data-id="' + esc(pid) + '">🖨️ ' + esc(t('Print / Save as PDF')) + '</button>' +
      '<button class="btn sky" data-act="rcpt-img" data-id="' + esc(pid) + '">🖼️ ' + esc(t('Save image')) + '</button>' +
      '<a class="btn ghost" href="https://wa.me/?text=' + encodeURIComponent(window.LWReceipt.text(r)) + '" target="_blank" rel="noopener">💬 ' + esc(t('Share on WhatsApp')) + '</a></div>' +
      '<p class="muted small">' + esc(t('To save a PDF: tap Print, then choose Save as PDF (iPhone: tap Share → Save to Files).')) + '</p></div></div>';
    document.body.classList.add('sheet-open');
  }

  /* timetable (read-only) */
  function viewTimetable() {
    var k = child();
    if (!k) return noChild();
    ensure('timetable');
    var x = S.tt[k.id], head = backBar('🗓️ ' + esc(t('Timetable')) + ' · ' + esc(className(k.classId)));
    if (!x) return head + (online ? '<div class="spinner"></div>' : '<p class="note warn">' + esc(t('Connect to the internet to see this.')) + '</p>');
    var d = x.d, periods = d ? arr(d.periods).filter(function (p) { return p && (p.time || arr(p.cells).some(Boolean)); }) : [];
    if (!periods.length) return head + '<section class="card"><div class="empty"><div class="e">🗓️</div><p>' + esc(t('No timetable yet. The class teacher will add it soon.')) + '</p></div></section>';
    if (ttDay < 0) { var wd = weekday(todayISO()); ttDay = wd === 0 ? 0 : wd - 1; }
    var html = head + '<section class="card"><div class="day-chips" role="tablist">' + DAYS.map(function (dn, i) {
      return '<button class="chip' + (!ttWeek && ttDay === i ? ' active' : '') + '" data-act="tt-day" data-i="' + i + '" role="tab" aria-selected="' + (!ttWeek && ttDay === i) + '">' + esc(t(dn)) + '</button>';
    }).join('') + '<button class="chip' + (ttWeek ? ' active' : '') + '" data-act="tt-week">' + esc(t('Full week')) + '</button></div>';
    if (ttWeek) {
      html += '<div class="tt-scroll"><table class="tt"><thead><tr><th>' + esc(t('Time')) + '</th>' + DAYS.map(function (dn) { return '<th>' + esc(t(dn)) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        periods.map(function (p) { return '<tr><th>' + esc(p.time || '') + '</th>' + DAYS.map(function (dn, i) { return '<td>' + esc(arr(p.cells)[i] || '') + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
    } else {
      html += '<ul class="tt-list">' + periods.map(function (p) { var c = arr(p.cells)[ttDay] || ''; return '<li class="' + (c ? '' : 'empty') + '"><span class="tm">' + esc(p.time || '') + '</span><b>' + esc(c || '—') + '</b></li>'; }).join('') + '</ul>';
    }
    if (d.note) html += '<p class="note small">' + linkify(d.note) + '</p>';
    return html + '</section>';
  }

  /* report cards (published only; the database decides) */
  function gradeOf(pct) { return pct >= 90 ? 'A+' : pct >= 75 ? 'A' : pct >= 60 ? 'B' : pct >= 45 ? 'C' : 'D'; }
  function rcResult(e, marks) {
    var rows = [], tot = 0, max = 0, numeric = true;
    arr(e.subjects).forEach(function (sub) {
      if (!sub || !sub.name) return;
      var v = marks ? marks[sub.name] : '';
      v = v == null ? '' : String(v);
      var mx = Number(sub.max) || 0, n = parseFloat(v), isNum = mx > 0 && v !== '' && isFinite(n);
      if (isNum) { tot += n; max += mx; } else if (mx > 0 && v !== '' && !/^ab$/i.test(v)) numeric = false;
      rows.push({ name: sub.name, value: v, max: mx, grade: isNum ? gradeOf(n / mx * 100) : (mx > 0 ? (/^ab$/i.test(v) ? 'AB' : '') : v) });
    });
    return { rows: rows, total: Math.round(tot * 100) / 100, max: max, pct: max > 0 && numeric ? Math.round(tot / max * 1000) / 10 : null };
  }
  function school() {
    var k = child(), f = k && S.fees[k.id], m = f && f.enabled && f.sum;
    return { name: (m && m.school_name) || 'The Little Wings Play School', address: (m && m.school_address) || 'Vuyyuru', phone: (m && m.school_phone) || OFFICE };
  }
  function rcFind(id) { var k = child(); return k && arr(S.rc[k.id]).filter(function (x) { return x.id === id; })[0]; }
  function rcHTML(x) {
    var k = child(), e = x.exam || {}, r = rcResult(e, x.marks), sc = school();
    return '<article class="rc"><header class="rc-head"><img src="../assets/logo.jpeg" alt="" width="58" height="58"><div><h1>' + esc(sc.name) + '</h1><p>' + esc(sc.address) + (sc.phone ? ' · ' + esc(sc.phone) : '') + '</p></div></header>' +
      '<h2 class="rc-title">' + esc(t('Progress Report')) + ' · ' + esc(e.name || '') + (e.year ? ' · ' + esc(e.year) : '') + '</h2>' +
      '<div class="rc-meta"><span>' + esc(t('Name')) + ': <b>' + esc(k.name) + '</b></span><span>' + esc(t('Class')) + ': <b>' + esc(className(x.classId || k.classId) + (k.section ? ' · ' + k.section : '')) + '</b></span>' +
      (S.name ? '<span>' + esc(t('Parent')) + ': <b>' + esc(S.name) + '</b></span>' : '') + (e.term || e.date ? '<span>' + esc([e.term, e.date ? shortDate(e.date) : ''].filter(Boolean).join(' · ')) + '</span>' : '') + '</div>' +
      '<table class="rc-tbl"><thead><tr><th>' + esc(t('Subject')) + '</th><th>' + esc(t('Marks')) + '</th><th>' + esc(t('Grade')) + '</th></tr></thead><tbody>' + r.rows.map(function (y) {
        return '<tr><td>' + esc(y.name) + '</td><td>' + (y.max > 0 ? esc(y.value === '' ? '—' : y.value) + ' / ' + y.max : '—') + '</td><td><b>' + esc(y.grade || (y.max > 0 ? '' : y.value) || '—') + '</b></td></tr>';
      }).join('') + (r.max > 0 ? '<tr class="tot"><td>' + esc(t('Total')) + '</td><td>' + r.total + ' / ' + r.max + '</td><td><b>' + (r.pct != null ? r.pct + '% · ' + gradeOf(r.pct) : '') + '</b></td></tr>' : '') + '</tbody></table>' +
      '<div class="rc-rem"><b>' + esc(t('Remarks')) + '</b><p>' + esc(x.remarks || '—') + '</p></div>' +
      '<p class="rc-key">' + esc(t('Grades: A+ 90%+ · A 75%+ · B 60%+ · C 45%+ · D below 45% · AB absent')) + '</p>' +
      '<div class="rc-sign"><div>' + esc(t('Class teacher')) + '</div><div>' + esc(t('Principal')) + '</div><div>' + esc(t('Parent')) + '</div></div></article>';
  }
  function rcText(x) {
    var k = child(), e = x.exam || {}, r = rcResult(e, x.marks), sc = school();
    return '📄 ' + sc.name + ' – ' + t('Progress report') + '\n' + k.name + ' (' + className(x.classId || k.classId) + ')\n' + (e.name || '') + (e.year ? ' · ' + e.year : '') + '\n\n' +
      r.rows.map(function (y) { return y.name + ': ' + (y.max > 0 ? (y.value === '' ? '—' : y.value) + '/' + y.max + (y.grade ? ' (' + y.grade + ')' : '') : (y.value || '—')); }).join('\n') +
      (r.max > 0 ? '\n' + t('Total') + ': ' + r.total + '/' + r.max + (r.pct != null ? ' (' + r.pct + '%)' : '') : '') + (x.remarks ? '\n\n' + t('Remarks') + ': ' + x.remarks : '') + '\n\n– ' + sc.name;
  }
  function viewReports() {
    var k = child();
    if (!k) return noChild();
    ensure('reports');
    var l = S.rc[k.id], head = backBar('📄 ' + esc(t('Report cards')));
    if (!l) return head + (online ? '<div class="spinner"></div>' : '<p class="note warn">' + esc(t('Connect to the internet to see this.')) + '</p>');
    if (!l.length) return head + '<section class="card"><div class="empty"><div class="e">📄</div><p>' + esc(t('No report cards yet. They appear here when the school publishes them.')) + '</p></div></section>';
    return head + '<section class="card"><ul class="rc-list">' + l.map(function (x) {
      var e = x.exam || {}, r = rcResult(e, x.marks);
      return '<li><div><b>' + esc(e.name || '') + '</b><small>' + esc([e.term, e.year, e.date ? shortDate(e.date) : ''].filter(Boolean).join(' · ')) + '</small></div>' +
        (r.pct != null ? '<span class="rc-pct">' + r.pct + '% · ' + gradeOf(r.pct) + '</span>' : '') + '<button class="btn small sky" data-act="rc-open" data-id="' + esc(x.id) + '">' + esc(t('Open')) + '</button></li>';
    }).join('') + '</ul></section>';
  }
  function openRC(id) {
    var x = rcFind(id); if (!x) return;
    $('#sheet-root').innerHTML = '<div class="sheet-bg" data-act="sheet-bg"><div class="sheet wide" id="rc-sheet" role="dialog" aria-modal="true" aria-label="' + esc(t('Report card')) + '"><div class="sheet-head"><h2>📄 ' + esc(t('Report card')) + '</h2><button class="icon-btn" data-act="sheet-close" aria-label="' + esc(t('Close')) + '">✕</button></div>' +
      '<div class="rc-preview">' + rcHTML(x) + '</div>' +
      '<div class="rcpt-actions"><button class="btn primary" data-act="rc-print" data-id="' + esc(id) + '">🖨️ ' + esc(t('Print / Save as PDF')) + '</button>' +
      '<a class="btn ghost" href="https://wa.me/?text=' + encodeURIComponent(rcText(x)) + '" target="_blank" rel="noopener">💬 ' + esc(t('Share on WhatsApp')) + '</a></div>' +
      '<p class="muted small">' + esc(t('To save a PDF: tap Print, then choose Save as PDF (iPhone: tap Share → Save to Files).')) + '</p></div></div>';
    document.body.classList.add('sheet-open');
  }
  function printDoc(inner, title, cls) {
    var root = $('#print-root'); if (!root) return;
    root.className = cls || ''; root.innerHTML = inner;
    var old = document.title;
    var restore = function () { document.title = old; root.innerHTML = ''; root.className = ''; window.removeEventListener('afterprint', restore); };
    var imgs = $$('img', root).filter(function (i) { return !i.complete; }), left = imgs.length, done = false;
    var go = function () { if (done) return; done = true; document.title = title || old; window.addEventListener('afterprint', restore); setTimeout(function () { window.print(); }, 80); };
    if (!left) return go();
    imgs.forEach(function (i) { i.onload = i.onerror = function () { if (--left <= 0) go(); }; });
    setTimeout(go, 5000);
  }

  /* gallery (private bucket, signed URLs) */
  function albumById(id) { return arr(S.albums).filter(function (a) { return a.id === id; })[0]; }
  function viewGallery() {
    ensure('gallery');
    if (album) return viewAlbum(album);
    var l = S.albums, head = backBar('📸 ' + esc(t('Gallery')));
    if (!l) return head + (online ? '<div class="spinner"></div>' : '<p class="note warn">' + esc(t('Connect to the internet to see this.')) + '</p>');
    var shown = l.filter(function (a) { return a.items.length; });
    if (!shown.length) return head + '<section class="card"><div class="empty"><div class="e">📸</div><p>' + esc(t('No photos yet. School and class albums will appear here.')) + '</p></div></section>';
    return head + '<div class="albums">' + shown.map(function (a) {
      var cover = a.items.filter(function (i) { return i.type === 'photo'; })[0];
      return '<button class="album" data-act="album" data-id="' + esc(a.id) + '"><span class="cover">' + (cover ? '<img alt="" loading="lazy" data-b="gallery" data-p="' + esc(cover.path) + '">' : '<span class="vid-ph">🎬</span>') + '</span>' +
        '<span class="al-t"><b>' + esc(a.title) + '</b><small>' + esc([a.day ? shortDate(a.day) : '', a.classId ? className(a.classId) : t('Whole school'), t('{0} photos/videos', a.items.length)].filter(Boolean).join(' · ')) + '</small></span></button>';
    }).join('') + '</div><p class="muted small center">🔒 ' + esc(t('Photos open only inside this app and links expire after an hour.')) + '</p>';
  }
  function viewAlbum(id) {
    var a = albumById(id);
    var head = '<div class="back-bar"><button class="btn small ghost" data-act="album" data-id="">← ' + esc(t('Gallery')) + '</button><h2>' + esc(a ? a.title : '') + '</h2></div>';
    if (!a) return head + '<section class="card"><p class="muted">' + esc(t('Album not found.')) + '</p></section>';
    return head + '<p class="muted small">' + esc([a.day ? niceDate(a.day) : '', a.classId ? className(a.classId) : t('Whole school')].filter(Boolean).join(' · ')) + '</p><div class="g-grid">' + a.items.map(function (i) {
      return i.type === 'video'
        ? '<button class="g-item vid" data-act="media" data-b="gallery" data-path="' + esc(i.path) + '" data-type="video" aria-label="' + esc(t('Video')) + '"><span>▶</span></button>'
        : '<button class="g-item" data-act="media" data-b="gallery" data-path="' + esc(i.path) + '" data-type="photo" aria-label="' + esc(t('Photo')) + '"><img alt="" loading="lazy" data-b="gallery" data-p="' + esc(i.path) + '"></button>';
    }).join('') + '</div>';
  }
  function openMedia(bucket, path, type) {
    var re = bucket === 'gallery' ? GALLERY_RE : CLASS_MEDIA_RE;
    if (!re.test(path)) return;
    var body = type === 'video' ? '<video controls playsinline autoplay preload="metadata" data-b="' + bucket + '" data-p="' + esc(path) + '"></video>' : '<img alt="" data-b="' + bucket + '" data-p="' + esc(path) + '">';
    $('#sheet-root').innerHTML = '<div class="sheet-bg media-bg" data-act="sheet-bg"><div class="media-view" role="dialog" aria-modal="true"><button class="icon-btn media-x" data-act="sheet-close" aria-label="' + esc(t('Close')) + '">✕</button>' + body + '</div></div>';
    document.body.classList.add('sheet-open');
    hydrate();
  }

  /* feedback */
  var FB_ERR = [[/wait/i, 'Please wait a minute before sending another message.'], [/5 messages/i, 'You can send up to 5 messages a day. Please call the school for anything urgent.'], [/3 to 1000/i, 'Please write at least 3 characters.']];
  function viewFeedback() {
    var k = child();
    if (!k) return noChild();
    ensure('feedback');
    var head = backBar('💬 ' + esc(t('Feedback')));
    var html = head + '<section class="card"><h2>✍️ ' + esc(t('Message to the school')) + '</h2><form id="fb-form" novalidate>' +
      (S.children.length > 1 ? '<label class="field"><span class="lbl">' + esc(t('About')) + '</span><select name="sid">' + S.children.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === S.cur ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select></label>' : '<input type="hidden" name="sid" value="' + esc(k.id) + '">') +
      '<label class="field"><span class="lbl sr-only">' + esc(t('Message to the school')) + '</span><textarea name="msg" rows="4" maxlength="1000" placeholder="' + esc(t('Write your message, question or suggestion…')) + '"></textarea></label>' +
      '<button class="btn primary block">📨 ' + esc(t('Send')) + '</button><p class="muted small">' + esc(t('For urgent matters please call the school office.')) + ' <a href="' + OFFICE_TEL + '">' + OFFICE + '</a></p></form></section>';
    var l = S.fb;
    html += '<section class="card"><h2>🗂️ ' + esc(t('My messages')) + '</h2>';
    if (!l) html += online ? '<div class="spinner"></div>' : '<p class="note warn">' + esc(t('Connect to the internet to see this.')) + '</p>';
    else if (!l.length) html += '<p class="muted">' + esc(t('No messages yet.')) + '</p>';
    else html += '<ul class="fb-list">' + l.map(function (f) {
      var st = f.status === 'Replied' ? 'Replied' : f.status === 'Seen' ? 'Seen' : 'Sent';
      return '<li><div class="row between"><small class="muted">' + esc(stamp(f.created_at)) + (f.student_name && S.children.length > 1 ? ' · ' + esc(f.student_name) : '') + '</small><span class="tag st-' + st.toLowerCase() + '">' + esc(t(st)) + '</span></div>' +
        '<p class="body">' + esc(f.message) + '</p>' + (f.reply ? '<div class="fb-reply"><b>🏫 ' + esc(t('Reply from school')) + '</b><p>' + linkify(f.reply) + '</p></div>' : '') + '</li>';
    }).join('') + '</ul>';
    return html + '</section>';
  }
  function bindFeedback() {
    var f = $('#fb-form'); if (!f) return;
    f.addEventListener('submit', function (e) { e.preventDefault(); sendFeedback(f); });
  }
  // Resolves true when the message was sent, false when it stayed (with the reason shown under the box).
  function sendFeedback(f) {
    if (f.__sending) return Promise.resolve(false);
    $$('.err', f).forEach(function (x) { x.remove(); }); $$('.invalid', f).forEach(function (x) { x.classList.remove('invalid'); });
    var msg = f.msg.value.trim(), sid = f.sid.value;
    if (msg.length < 3) { fieldErr(f, 'msg', t('Please write at least 3 characters.')); return Promise.resolve(false); }
    if (navigator.onLine === false) { fieldErr(f, 'msg', t('No internet. Please try again.')); return Promise.resolve(false); }
    var btn = $('button.primary', f); btn.disabled = true; btn.textContent = t('Sending…'); f.__sending = true;
    return SB.rpc('parent_feedback_send', { p_student: sid, p_message: msg }).then(function (r) {
      if (r.error) throw r.error;
      f.__sending = false;
      toast(t('Message sent. The school will reply here.'));
      f.msg.value = '';
      loadFeedback().then(function () { saveCache(); render(); });
      return true;
    }).catch(function (err) {
      f.__sending = false;
      btn.disabled = false; btn.textContent = '📨 ' + t('Send');
      var m = (err && err.message) || '', hit = FB_ERR.filter(function (x) { return x[0].test(m); })[0];
      fieldErr(f, 'msg', hit ? t(hit[1]) : isNetErr(err) ? t('No internet. Please try again.') : t('Could not send. Please try again.'));
      return false;
    });
  }
  /* v1.6: a typed, unsent feedback message is never dropped silently. */
  function fbDirty() { var f = $('#fb-form'); return !!(f && tab === 'feedback' && f.msg && f.msg.value.trim()); }
  var askOpen = null;
  function askUnsaved() {
    if (askOpen) return askOpen;
    var back = document.activeElement, root = document.createElement('div');
    root.id = 'unsaved-root'; document.body.appendChild(root);
    askOpen = new Promise(function (resolve) {
      root.innerHTML = '<div class="ask-bg"><div class="ask" role="alertdialog" aria-modal="true" aria-labelledby="ask-h" aria-describedby="ask-p"><h3 id="ask-h">⚠️ ' + esc(t('You have unsaved changes')) + '</h3><p id="ask-p">' + esc(t('Send your message before you leave?')) + '</p>' +
        '<div class="ask-actions"><button type="button" class="btn primary" data-u="save">📨 ' + esc(t('Send')) + '</button><button type="button" class="btn ghost keep" data-u="keep">✏️ ' + esc(t('Keep editing')) + '</button><button type="button" class="btn danger-o" data-u="discard">🗑️ ' + esc(t('Discard')) + '</button></div></div></div>';
      var btns = $$('[data-u]', root);
      var finish = function (v) { document.removeEventListener('keydown', onKey, true); root.remove(); askOpen = null; if (v === 'keep' && back && back.isConnected) { try { back.focus(); } catch (e) { /* ignore */ } } resolve(v); };
      var onKey = function (e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish('keep'); }
        else if (e.key === 'Tab') { e.preventDefault(); var i = btns.indexOf(document.activeElement); btns[(i + (e.shiftKey ? btns.length - 1 : 1)) % btns.length].focus(); }
      };
      document.addEventListener('keydown', onKey, true);
      btns.forEach(function (b) { b.addEventListener('click', function (e) { e.stopPropagation(); finish(b.getAttribute('data-u')); }); });
      $('.ask-bg', root).addEventListener('click', function (e) { if (e.target === e.currentTarget) finish('keep'); });
      $('[data-u=keep]', root).focus();
    });
    return askOpen;
  }
  function guardFb(proceed) {
    if (!fbDirty()) { proceed(); return; }
    askUnsaved().then(function (c) {
      if (c === 'discard') { var f = $('#fb-form'); if (f) f.msg.value = ''; proceed(); }
      else if (c === 'save') sendFeedback($('#fb-form')).then(function (ok) { if (ok) proceed(); });
    });
  }
  window.addEventListener('beforeunload', function (e) { if (fbDirty()) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------- phone alerts (Web Push) ----------
   * Opt-in only. The subscription is stored through push_subscribe (own row,
   * RLS) and removed on "Turn off" and on sign-out. The public VAPID key comes
   * from the lw-push Edge Function; the private key never leaves the server. */
  var PUSH = { supported: 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window, on: false, sub: null, cfg: null, busy: false, msg: '' };
  function b64uToU8(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function swReg() { return navigator.serviceWorker.getRegistration('./').then(function (r) { return r || navigator.serviceWorker.ready; }); }
  function pushConfig(force) {
    if (PUSH.cfg && !force) return Promise.resolve(PUSH.cfg);
    return SB.functions.invoke('lw-push', { body: { action: 'config' } }).then(function (r) {
      if (r.error) throw r.error;
      PUSH.cfg = r.data || { configured: false };
      return PUSH.cfg;
    });
  }
  function saveSub(sub) {
    var j = sub.toJSON(), k = j.keys || {};
    return SB.rpc('push_subscribe', { p_endpoint: j.endpoint, p_p256dh: k.p256dh, p_auth: k.auth, p_lang: LANG }).then(function (r) {
      if (r.error) throw r.error;
      PUSH.sub = sub; PUSH.on = true;
    });
  }
  // On every app start: re-link this phone's subscription to the signed-in parent (and language).
  function pushSync() {
    if (!PART_B || !PUSH.supported || !SB || !S) return;
    swReg().then(function (reg) { return reg && reg.pushManager.getSubscription(); }).then(function (sub) {
      PUSH.sub = sub || null; PUSH.on = !!(sub && Notification.permission === 'granted');
      if (PUSH.on && online) return saveSub(sub);
    }).then(function () { if (S) render(); }).catch(function () { /* keep quiet */ });
  }
  function pushOn() {
    if (PUSH.busy) return;
    if (!PUSH.supported) { PUSH.msg = isIOS() && !isStandalone() ? 'iPhone: alerts work only after you add this app to the Home Screen (Share → Add to Home Screen) and open it from there.' : 'This browser cannot show alerts. Try Chrome on Android, or install the app on iPhone.'; render(); return; }
    if (navigator.onLine === false) { toast(t('No internet. Please try again.'), 'err'); return; }
    PUSH.busy = true; PUSH.msg = ''; render();
    var cfg;
    pushConfig(true).then(function (c) {
      cfg = c;
      if (!c.configured || !c.publicKey) { var e = new Error('nocfg'); e.key = 'Alerts are not set up by the school yet.'; throw e; }
      return Notification.requestPermission();
    }).then(function (perm) {
      if (perm !== 'granted') { var e = new Error('denied'); e.key = 'Notifications are blocked. Allow them in your phone settings for this app, then try again.'; throw e; }
      return swReg();
    }).then(function (reg) {
      var key = b64uToU8(cfg.publicKey);
      return reg.pushManager.getSubscription().then(function (old) {
        if (!old) return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        // Keys changed at the school: replace the old subscription.
        var ok = false;
        try { var ok0 = old.options && old.options.applicationServerKey && new Uint8Array(old.options.applicationServerKey); ok = !!ok0 && ok0.length === key.length && ok0.every(function (b, i) { return b === key[i]; }); } catch (e) { ok = false; }
        if (ok) return old;
        return old.unsubscribe().then(function () { return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }); });
      });
    }).then(saveSub).then(function () {
      PUSH.busy = false; lsSet('lwp_alert_hide', true); toast(t('Alerts turned on 🔔')); render();
    }).catch(function (e) {
      PUSH.busy = false; PUSH.msg = (e && e.key) || (isNetErr(e) ? 'No internet. Please try again.' : 'Could not turn on alerts. Please try again.'); render();
    });
  }
  function pushDrop() {
    if (!PUSH.supported || !SB) return Promise.resolve();
    return swReg().then(function (reg) { return reg && reg.pushManager.getSubscription(); }).then(function (sub) {
      if (!sub) return;
      var ep = sub.endpoint;
      return SB.rpc('push_unsubscribe', { p_endpoint: ep }).catch(function () {}).then(function () { return sub.unsubscribe(); });
    }).then(function () { PUSH.sub = null; PUSH.on = false; });
  }
  function pushOff() {
    if (PUSH.busy) return;
    PUSH.busy = true; render();
    pushDrop().catch(function () {}).then(function () { PUSH.busy = false; PUSH.msg = ''; toast(t('Alerts turned off')); render(); });
  }
  function pushTest() {
    if (PUSH.busy) return;
    PUSH.busy = true; render();
    SB.functions.invoke('lw-push', { body: { action: 'test' } }).then(function (r) {
      PUSH.busy = false;
      if (r.error) { var st = r.error.context && r.error.context.status; toast(t(st === 429 ? 'Please wait a minute and try again.' : 'Could not send. Please try again.'), 'err'); }
      else if (r.data && r.data.configured === false) { PUSH.msg = 'Alerts are not set up by the school yet.'; }
      else toast(t('Test alert sent'));
      render();
    }).catch(function () { PUSH.busy = false; toast(t('Could not send. Please try again.'), 'err'); render(); });
  }
  function viewAlerts() {
    var head = backBar('🔔 ' + esc(t('Alerts')));
    var ios = isIOS() && !isStandalone();
    var html = head + '<section class="card"><p>' + esc(t('Get a phone notification for new notices, homework, absence, fee reminders and new photos.')) + '</p>';
    html += '<div class="alert-state ' + (PUSH.on ? 'on' : 'off') + '">' + (PUSH.on ? '🔔 ' + esc(t('Alerts are on for this phone ✓')) : '🔕 ' + esc(t('Alerts are off on this phone.'))) + '</div>';
    if (PUSH.on) html += '<p><button class="btn sky block" data-act="push-test"' + (PUSH.busy ? ' disabled' : '') + '>📳 ' + esc(t('Send a test alert')) + '</button></p><p><button class="btn ghost block" data-act="push-off"' + (PUSH.busy ? ' disabled' : '') + '>🔕 ' + esc(t('Turn off alerts')) + '</button></p>';
    else html += '<p><button class="btn primary block" data-act="push-on"' + (PUSH.busy ? ' disabled' : '') + '>' + (PUSH.busy ? '⏳ ' : '🔔 ') + esc(t('Turn on alerts')) + '</button></p>';
    if (PUSH.msg) html += '<p class="note warn">' + esc(t(PUSH.msg)) + '</p>';
    html += '<p class="note small' + (ios ? ' warn' : '') + '">📱 ' + esc(t('iPhone: alerts work only after you add this app to the Home Screen (Share → Add to Home Screen) and open it from there.')) + '</p></section>';
    if (ios) html += '<section class="card">' + installHint().replace('class="install-hint"', 'class="install-hint" style="margin:0"') + '</section>';
    return html;
  }

  function noChild() {
    return '<section class="card"><div class="empty"><div class="e">🧒</div><p><b>' + esc(t('No child is linked to this login yet.')) + '</b><br>' + esc(t('Please contact the school office:')) + ' <a href="' + OFFICE_TEL + '">' + OFFICE + '</a>.</p></div></section>' +
      '<section class="card"><h2>📢 ' + esc(t('Notices')) + '</h2>' + (S.notices.length ? S.notices.map(function (n) { return noticeHTML(n, false); }).join('') : '<p class="muted">' + esc(t('No notices right now.')) + '</p>') + '</section>';
  }
  function nav() {
    var nc = S ? newCount() : 0, np = S ? newPosts() : 0, cur = SUB_TABS.indexOf(tab) !== -1 ? 'more' : tab;
    return '<nav class="bottomnav" aria-label="Main">' + [['home', '🏠', 'Home'], ['calendar', '📅', 'Attendance'], ['updates', '📚', 'Updates'], ['notices', '📢', 'Notices'], ['more', '☰', 'More']].map(function (x) {
      var dot = x[0] === 'notices' && nc && tab !== 'notices' ? nc : x[0] === 'updates' && np && tab !== 'updates' ? np : 0;
      return '<button data-act="tab" data-tab="' + x[0] + '" class="' + (cur === x[0] ? 'active' : '') + '"' + (cur === x[0] ? ' aria-current="page"' : '') + '><span class="ni">' + x[1] + '</span><span class="nl">' + esc(t(x[2])) + '</span>' + (dot ? '<span class="dot">' + (dot > 9 ? '9+' : dot) + '</span>' : '') + '</button>';
    }).join('') + '</nav>';
  }
  function updateNavDot() { var n = $('.bottomnav'); if (n) n.outerHTML = nav(); }

  var VIEWS = { home: viewHome, calendar: viewCalendar, updates: viewUpdates, notices: viewNotices, more: viewMore, fees: viewFees, timetable: viewTimetable, reports: viewReports, gallery: viewGallery, feedback: viewFeedback, alerts: viewAlerts };
  if (!PART_B) delete VIEWS.alerts;
  function render() {
    if (!S) return;
    var y = window.scrollY;
    var keep = $('#fb-form') && tab === 'feedback' ? { msg: $('#fb-form').msg.value, focus: document.activeElement && document.activeElement.name === 'msg' } : null;
    var body = (VIEWS[tab] || viewHome)();
    $('#app').innerHTML = header() + '<main class="view" id="view">' + body + '<p class="muted small center">' + esc(t('Little Wings Parents')) + ' v' + VERSION + ' · ' + esc(t('India time')) + '</p></main>' + nav();
    document.title = (child() ? child().name + ' · ' : '') + t('Little Wings Parents');
    window.scrollTo(0, y);
    if (tab === 'feedback') { bindFeedback(); if (keep && $('#fb-form')) { $('#fb-form').msg.value = keep.msg; if (keep.focus) $('#fb-form').msg.focus(); } }
    hydrate();
  }

  /* ---------- language ---------- */
  function applyLang(l, saveRemote) {
    LANG = l === 'te' || l === 'hi' ? l : 'en';
    try { localStorage.setItem('lw-lang', LANG); } catch (e) { /* ignore */ }
    document.documentElement.lang = LANG === 'en' ? 'en-IN' : LANG + '-IN';
    var b = $('#sw-update'); if (b) b.textContent = t('New version available — tap to refresh');
    if (saveRemote && SB && S) {
      SB.auth.updateUser({ data: { lw_lang: LANG } }).catch(function () {});
      if (PUSH.on && PUSH.sub) saveSub(PUSH.sub).catch(function () {});
    }
  }

  /* ---------- account sheet ---------- */
  function openSheet() {
    var kids = S.children.map(function (k) { return esc(k.name) + ' (' + esc(className(k.classId) + (k.section ? ' · ' + t('Sec') + ' ' + k.section : '') + (k.status === 'Inactive' ? ', ' + t('Inactive') : '')) + ')'; }).join(', ');
    $('#sheet-root').innerHTML = '<div class="sheet-bg" data-act="sheet-bg"><div class="sheet" id="acct-sheet" role="dialog" aria-modal="true" aria-label="' + esc(t('My account')) + '"><div class="sheet-head"><h2>👤 ' + esc(t('My account')) + '</h2><button class="icon-btn" data-act="sheet-close" aria-label="' + esc(t('Close')) + '">✕</button></div>' +
      '<p><b>' + esc(S.name || t('Parent')) + '</b><br><span class="muted">📱 ' + esc(fmtMobile(S.phone)) + (kids ? '<br>🧒 ' + kids : '') + '</span></p>' +
      (PART_B ? '<p class="lbl small">🌐 ' + esc(t('Language')) + '</p>' + langPicker() : '') +
      '<details><summary class="link">🔐 ' + esc(t('Change my password')) + '</summary><form id="pw-form" novalidate style="margin-top:.7rem">' +
      '<label class="field"><span class="lbl">' + esc(t('New password (at least 8 characters)')) + '</span><span class="pw-wrap"><input name="password" type="password" autocomplete="new-password" maxlength="72"><button type="button" class="pw-toggle" data-act="pw" aria-label="' + esc(t('Show password')) + '">👁️</button></span></label>' +
      '<label class="field"><span class="lbl">' + esc(t('Confirm new password')) + '</span><span class="pw-wrap"><input name="password2" type="password" autocomplete="new-password" maxlength="72"><button type="button" class="pw-toggle" data-act="pw" aria-label="' + esc(t('Show password')) + '">👁️</button></span></label>' +
      '<button class="btn sky">' + esc(t('Save new password')) + '</button></form></details>' +
      '<p class="note small">' + esc(t('Need help or forgot your password? Call the school office:')) + ' <a href="' + OFFICE_TEL + '">' + OFFICE + '</a>.</p>' +
      installHint() +
      '<p style="margin-top:1rem"><button class="btn primary block" data-act="signout">🚪 ' + esc(t('Sign out')) + '</button></p><p class="muted small center">' + esc(t('Signing out removes your child’s details from this phone.')) + '</p></div></div>';
    document.body.classList.add('sheet-open');
    var f = $('#pw-form');
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      $$('.err', f).forEach(function (x) { x.remove(); }); $$('.invalid', f).forEach(function (x) { x.classList.remove('invalid'); });
      var a = f.password.value, b = f.password2.value;
      if (a.length < 8) return fieldErr(f, 'password', t('Use at least 8 characters'));
      if (a !== b) return fieldErr(f, 'password2', t('Passwords do not match'));
      var btn = $('button.sky', f); btn.disabled = true;
      SB.auth.updateUser({ password: a }).then(function (r) {
        btn.disabled = false;
        if (r.error) return fieldErr(f, 'password', /different/i.test(r.error.message) ? t('Choose a password different from the old one') : isNetErr(r.error) ? t('No internet. Please try again.') : r.error.message);
        f.reset(); toast(t('Password changed 🔐')); closeSheet();
      }).catch(function (err) { btn.disabled = false; fieldErr(f, 'password', isNetErr(err) ? t('No internet. Please try again.') : err.message); });
    });
  }
  function closeSheet() { var r = $('#sheet-root'); if (r) { $$('video', r).forEach(function (v) { try { v.pause(); } catch (e) { /* ignore */ } }); r.innerHTML = ''; } document.body.classList.remove('sheet-open'); }

  /* ---------- events ---------- */
  function go(tb) {
    if (!VIEWS[tb]) tb = 'home';
    tab = tb; if (tb !== 'gallery') album = '';
    if (tab === 'calendar' && !S.month) S.month = thisMonth();
    render(); window.scrollTo(0, 0);
  }
  var ACTS = {
    pw: function (el) { var i = el.parentNode.querySelector('input'); var show = i.type === 'password'; i.type = show ? 'text' : 'password'; el.textContent = show ? '🙈' : '👁️'; el.setAttribute('aria-label', show ? t('Hide password') : t('Show password')); },
    tab: function (el) { var tb = el.getAttribute('data-tab'); if (tb === tab) { closeSheet(); go(tb); return; } guardFb(function () { closeSheet(); go(tb); }); },
    kid: function (el) {
      S.cur = el.getAttribute('data-id'); ttDay = -1; saveCache(); render(); var k = child();
      if (k && online) Promise.all([rpcAttendance(k.id, thisMonth()), rpcFees(k.id), loadPosts(k.id), S.month !== thisMonth() ? rpcAttendance(k.id, S.month) : null]).then(function () { inflight['posts:' + k.id + ':done'] = true; saveCache(); render(); }).catch(function (e) { if (isNetErr(e)) { online = false; render(); } });
    },
    month: function (el) {
      var n = addMonths(S.month, +el.getAttribute('data-d'));
      if (n > thisMonth() || n < addMonths(thisMonth(), -23)) return;
      S.month = n; render();
    },
    refresh: function () { if (navigator.onLine === false) { online = false; render(); toast(t('You are offline'), 'err'); return; } refresh(true).then(function () { if (online && S && !S.error) toast(t('Updated ✓')); }); render(); },
    account: openSheet,
    lang: function (el) {
      var l = el.getAttribute('data-lang'); if (l === LANG) return;
      applyLang(l, true);
      if (S) { var acct = !!$('#acct-sheet'); render(); if (acct) openSheet(); toast(t('Language saved')); }
      else showLogin(loginMsg && loginMsg.msg, loginMsg && loginMsg.isErr);
    },
    receipt: function (el) { openReceipt(el.getAttribute('data-id')); },
    'rcpt-print': function (el) { var r = receiptFor(el.getAttribute('data-id')); if (r) window.LWReceipt.print([r], 'Receipt ' + r.receiptNo + ' - ' + r.studentName); },
    'rcpt-img': function (el) { var r = receiptFor(el.getAttribute('data-id')); if (r) window.LWReceipt.saveImage(r, 'Receipt ' + r.receiptNo + ' - ' + r.studentName).then(function (x) { if (x === 'downloaded') toast(t('Receipt image saved')); }).catch(function () { toast(t('Could not make the image'), 'err'); }); },
    'rc-open': function (el) { openRC(el.getAttribute('data-id')); },
    'rc-print': function (el) { var x = rcFind(el.getAttribute('data-id')); if (x) printDoc(rcHTML(x), 'Report card - ' + child().name + ' - ' + (x.exam.name || ''), 'rc-print'); },
    'tt-day': function (el) { ttDay = +el.getAttribute('data-i'); ttWeek = false; render(); },
    'tt-week': function () { ttWeek = !ttWeek; render(); },
    album: function (el) { album = el.getAttribute('data-id') || ''; render(); window.scrollTo(0, 0); },
    media: function (el) { openMedia(el.getAttribute('data-b'), el.getAttribute('data-path'), el.getAttribute('data-type')); },
    photo: function (el) { openMedia(el.getAttribute('data-b'), el.getAttribute('data-path'), 'photo'); },
    'push-on': pushOn, 'push-off': pushOff, 'push-test': pushTest,
    'alert-hide': function () { lsSet('lwp_alert_hide', true); render(); },
    'sheet-close': closeSheet,
    'sheet-bg': function (el, e) { if (e.target === el) closeSheet(); },
    signout: function () { guardFb(function () { signOut(); }); },
    install: function () { if (!deferredInstall) return; var ev = deferredInstall; deferredInstall = null; ev.prompt(); ev.userChoice.finally(function () { var w = $('#install-btn-wrap'); if (w) w.hidden = true; }); }
  };
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-act]');
    if (!el) return;
    var fn = ACTS[el.getAttribute('data-act')];
    if (!fn) return;
    if (el.tagName === 'BUTTON' && el.type !== 'submit') e.preventDefault();
    try { fn(el, e); } catch (err) { console.error(err); }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });
  window.addEventListener('online', function () { online = true; if (S) refresh(true); });
  window.addEventListener('offline', function () { online = false; if (S) render(); });
  document.addEventListener('visibilitychange', function () { if (S && document.visibilityState === 'visible' && Date.now() - lastRefresh > 15000) refresh(true); });

  // pull to refresh (when scrolled to the top)
  (function () {
    var y0 = null, dy = 0, ptr = $('#ptr');
    document.addEventListener('touchstart', function (e) { if (!S || window.scrollY > 0 || $('#sheet-root').innerHTML) { y0 = null; return; } y0 = e.touches[0].clientY; dy = 0; }, { passive: true });
    document.addEventListener('touchmove', function (e) {
      if (y0 == null) return;
      dy = e.touches[0].clientY - y0;
      if (dy > 0) ptr.style.transform = 'translateY(' + Math.min(dy * 0.5, 70) + 'px)';
    }, { passive: true });
    document.addEventListener('touchend', function () {
      if (y0 == null) return;
      if (dy > 90) {
        ptr.classList.add('spin'); ptr.style.transform = 'translateY(60px)';
        refresh(true).then(function () { ptr.classList.remove('spin'); ptr.style.transform = ''; });
        render();
      } else ptr.style.transform = '';
      y0 = null; dy = 0;
    });
  })();

  /* ---------- PWA ---------- */
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferredInstall = e; var w = $('#install-btn-wrap'); if (w) w.hidden = false; });
  window.addEventListener('appinstalled', function () { deferredInstall = null; toast(t('App installed. Open it from your Home Screen.')); });
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    var reload = false;
    navigator.serviceWorker.register('./sw.js', { scope: './' }).then(function (reg) {
      function waiting(w) {
        if (!w) return;
        if (!navigator.serviceWorker.controller) { w.postMessage({ type: 'SKIP_WAITING' }); return; }
        var bar = $('#sw-update'); bar.hidden = false;
        bar.onclick = function () { reload = true; bar.disabled = true; w.postMessage({ type: 'SKIP_WAITING' }); };
      }
      if (reg.waiting) waiting(reg.waiting);
      reg.addEventListener('updatefound', function () { var w = reg.installing; if (w) w.addEventListener('statechange', function () { if (w.state === 'installed' && reg.waiting) waiting(reg.waiting); }); });
    }).catch(function () { /* app still works without it */ });
    navigator.serviceWorker.addEventListener('controllerchange', function () { if (reload) location.reload(); });
    // A tapped alert opens the right screen.
    navigator.serviceWorker.addEventListener('message', function (e) { var d = e.data || {}; if (d.type === 'OPEN_TAB' && S && VIEWS[d.tab]) { closeSheet(); go(d.tab); if (online) refresh(false); } });
  }
  var TAB_ALIAS = { attendance: 'calendar' };
  function tabFromHash() {
    var m = /[#&]tab=([a-z]+)/.exec(location.hash || '');
    if (!m) return;
    var tb = TAB_ALIAS[m[1]] || m[1];
    if (VIEWS[tb]) tab = tb;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
  }

  window.addEventListener('hashchange', function () { if (!S || !/[#&]tab=/.test(location.hash)) return; guardFb(function () { tabFromHash(); closeSheet(); go(tab); }); });

  /* ---------- boot ---------- */
  window.__lwp = { version: VERSION, state: function () { return S; }, lang: function () { return LANG; }, t: t, go: function (x) { go(x); }, push: PUSH };
  function boot() {
    applyLang(LANG, false);
    if (!SB) { $('#app').innerHTML = '<div class="auth-wrap"><div class="auth-card center"><h1>' + esc(t('Little Wings Parents')) + '</h1><p class="note warn">' + esc(t('The app could not start. Check your internet connection and reload.')) + '</p><button class="btn primary" onclick="location.reload()">' + esc(t('Reload')) + '</button></div></div>'; return; }
    tabFromHash();
    SB.auth.getSession().then(function (r) {
      var sess = r && r.data && r.data.session;
      if (!sess) { clearAllLocalExceptLast(); return showLogin(); }
      start(sess.user);
    }).catch(function () { showLogin(t('You appear to be offline. Please connect to the internet and try again.'), true); });
    SB.auth.onAuthStateChange(function (ev) { if (ev === 'SIGNED_OUT' && S) { stopLive(); clearAllLocal(); showLogin(t('Your session ended. Please sign in again.')); } });
  }
  function clearAllLocalExceptLast() { var last = lsGet('lwp_last'); clearAllLocal(); if (last) lsSet('lwp_last', last); }
  registerSW();
  boot();
})();
