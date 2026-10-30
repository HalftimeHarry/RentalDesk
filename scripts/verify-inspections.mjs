/**
 * End-to-end verification of the inspection workflow through the running app:
 * create from lease -> edit form -> save with O observations + photo -> reopen
 * restores values -> print/PDF view (staff + tenant) -> move-out snapshot ->
 * signed copy upload -> access control. Fixtures are temporary; superuser is
 * used only to create/remove them. Requires the dev server on localhost:5173.
 *
 * Usage: node --env-file=.env scripts/verify-inspections.mjs
 */
import PocketBase from 'pocketbase';
import { assertSafePocketBaseTarget } from './lib/pocketbase-target-guard.mjs';

// Plain-JS import of the shared checklist template (type stripping).
const { emptyChecklist, INSPECTION_SECTIONS } = await import('../src/lib/inspection.ts');

const PB = process.env.PUBLIC_POCKETBASE_URL;
const APP = process.env.APP_URL || 'http://localhost:5173';
assertSafePocketBaseTarget(PB);
const pw = `Rd!${Math.random().toString(36).slice(2)}wQ4`;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(32).fill(0)]);

let failed = 0;
const check = (name, ok, detail = '') => {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
	if (!ok) failed++;
};

const cookieFrom = (res) => {
	const set = res.headers.getSetCookie?.() ?? [];
	const pbAuth = set.find((c) => c.startsWith('pb_auth='));
	return pbAuth ? pbAuth.split(';')[0] : '';
};

async function appLogin(email) {
	const res = await fetch(`${APP}/login`, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' },
		body: new URLSearchParams({ email, password: pw }),
		redirect: 'manual'
	});
	return cookieFrom(res);
}

const su = new PocketBase(PB);
su.autoCancellation(false);
await su
	.collection('_superusers')
	.authWithPassword(process.env.PRIVATE_POCKETBASE_SUPERUSER_EMAIL, process.env.PRIVATE_POCKETBASE_SUPERUSER_PASSWORD);

const fixtures = { users: [], leases: [], inspections: [], documents: [] };

try {
	// ---- fixtures -------------------------------------------------------------
	const admin = await su.collection('users').create({
		email: 'rdtest-insp-admin@example.com', password: pw, passwordConfirm: pw, name: 'Insp Admin', role: 'admin'
	});
	const tenant = await su.collection('users').create({
		email: 'rdtest-insp-tenant@example.com', password: pw, passwordConfirm: pw, name: 'Taylor Tenant', role: 'tenant'
	});
	fixtures.users.push(admin.id, tenant.id);
	const lease = await su.collection('leases').create({
		tenant: tenant.id,
		start_date: '2026-10-30',
		end_date: '2027-04-29',
		monthly_rent_cents: 225000,
		deposit_cents: 50000,
		status: 'active'
	});
	fixtures.leases.push(lease.id);

	const adminCookie = await appLogin('rdtest-insp-admin@example.com');
	check('admin login through the app', adminCookie.includes('pb_auth='));

	// ---- create move-in inspection from the lease ------------------------------
	const mkFd = new FormData();
	mkFd.append('lease', lease.id);
	mkFd.append('type', 'move_in');
	const created = await fetch(`${APP}/dashboard/inspections?/createInspection`, {
		method: 'POST', headers: { cookie: adminCookie, accept: 'text/html' }, body: mkFd, redirect: 'manual'
	});
	const location = created.headers.get('location') ?? '';
	const inspId = location.split('/').pop();
	check('create move-in inspection redirects to editor', created.status === 303 && /\/dashboard\/inspections\/[a-z0-9]+/.test(location), `status ${created.status}`);
	const createdRec = await su.collection('inspections').getOne(inspId);
	fixtures.inspections.push(inspId);

	// ---- editor loads with lease-derived header --------------------------------
	const editUrl = `${APP}/dashboard/inspections/${inspId}`;
	const edit1 = await fetch(editUrl, { headers: { cookie: adminCookie } }).then((r) => r.text());
	check('editor loads (200)', edit1.length > 1000);
	check('header shows default property address', edit1.includes('2728 B Street, San Diego CA 92102'));
	check('header shows unit 102', edit1.includes('102'));
	check('header shows tenant from lease', edit1.includes('Taylor Tenant'));
	check('move-in date comes from the lease (2026-10-30)', edit1.includes('2026-10-30'));
	check('no hardcoded 2027-03-01 date', !edit1.includes('2027-03-01'));
	check('created by is the signed-in admin', edit1.includes('Insp Admin'));
	for (const s of INSPECTION_SECTIONS) check(`checklist section present: ${s.section}`, edit1.includes(s.section));
	check('doorbell item present', edit1.includes('Doorbell / Security Device'));

	// ---- save with the three O observations + a photo ---------------------------
	const checklist = emptyChecklist();
	const targets = [
		['Dining Area', 'Windows / Screens / Blinds', 'Hole in screen.'],
		['Kitchen', 'Cabinets / Counters / Hardware', 'Under-sink cabinet drawer out of alignment.'],
		['Systems / Safety / Security', 'Doorbell / Security Device', 'Nonworking doorbell.']
	];
	const indices = {};
	for (const [section, item, comment] of targets) {
		const idx = checklist.findIndex((c) => c.section === section && c.item === item);
		if (idx < 0) { check(`template contains ${section} → ${item}`, false); continue; }
		checklist[idx].moveIn = { condition: 'other', comment, photos: [] };
		indices[item] = idx;
	}
	const saveFd = new FormData();
	saveFd.append('address', '2728 B Street, San Diego CA 92102');
	saveFd.append('unit', '102');
	saveFd.append('tenant_names', 'Taylor Tenant');
	saveFd.append('move_in_date', '2026-10-30');
	saveFd.append('move_out_date', '');
	saveFd.append('date', '2026-10-30');
	saveFd.append('type', 'move_in');
	saveFd.append('stage', 'tenant_reviewed');
	saveFd.append('notes', 'General notes on the report.');
	saveFd.append('manager_notes', 'PRIVATE-MARKER-7X9 should never reach tenant output');
	saveFd.append('lease_id', lease.id);
	saveFd.append('checklist', JSON.stringify(checklist));
	saveFd.append(
		`photo_moveIn_${indices['Doorbell / Security Device']}`,
		new File([PNG], 'doorbell.png', { type: 'image/png' })
	);
	const saved = await fetch(`${editUrl}?/saveInspection`, {
		method: 'POST', headers: { cookie: adminCookie, accept: 'text/html' }, body: saveFd
	});
	check('save inspection accepted', saved.status === 200, `status ${saved.status}`);
	const savedHtml = await saved.text();
	check('save shows success state', savedHtml.includes('Inspection saved.'));

	// ---- reopen restores values -------------------------------------------------
	const edit2 = await fetch(editUrl, { headers: { cookie: adminCookie } }).then((r) => r.text());
	check('reopen restores comment: hole in screen', edit2.includes('Hole in screen.'));
	check('reopen restores comment: cabinet drawer', edit2.includes('Under-sink cabinet drawer out of alignment.'));
	check('reopen restores comment: doorbell', edit2.includes('Nonworking doorbell.'));

	const serverRec = await su.collection('inspections').getOne(inspId);
	// Stage/occupancy values persist on the record but are no longer shown as controls.
	check(
		'workflow stage preserved on the record, control removed from form',
		serverRec.stage === 'tenant_reviewed' && !edit2.includes('Workflow stage')
	);
	const doorbell = serverRec.checklist.find((c) => c.item === 'Doorbell / Security Device');
	check('PocketBase record holds O condition + comment', doorbell?.moveIn?.condition === 'other' && doorbell.moveIn.comment === 'Nonworking doorbell.');
	check('photo attachment stored as document reference', (doorbell?.moveIn?.photos?.length ?? 0) === 1);
	if (doorbell?.moveIn?.photos?.[0]) fixtures.documents.push(doorbell.moveIn.photos[0]);

	// ---- fresh session still shows saved values ---------------------------------
	const adminCookie2 = await appLogin('rdtest-insp-admin@example.com');
	const edit3 = await fetch(editUrl, { headers: { cookie: adminCookie2 } }).then((r) => r.text());
	check('fresh login: saved comments still present', edit3.includes('Nonworking doorbell.'));

	// ---- collapsible sections -----------------------------------------------------
	check('sections start collapsed', (edit3.match(/aria-expanded="false"/g) || []).length >= 9);
	check('collapsed section shows O-item count', edit3.includes('· 1 issue'));
	check(
		'amber exception summary while collapsed',
		edit3.includes('bg-amber-50') && edit3.includes('Windows / Screens / Blinds — Hole in screen.')
	);
	check('expand/collapse all controls', edit3.includes('Expand all') && edit3.includes('Collapse all'));

	// ---- simplified exception entry -------------------------------------------
	check('each item has an O “Other condition” checkbox', (edit3.match(/O — Other condition/g) || []).length >= 50);
	check(
		'comment fields appear only where O is checked',
		(edit3.match(/Describe the condition/g) || []).length === 3
	);

	// ---- print / PDF view (staff) ------------------------------------------------
	const print1 = await fetch(`${editUrl}/print`, { headers: { cookie: adminCookie } }).then((r) => r.text());
	check('report title', print1.includes('Property Inspection Report'));
	check('report header fields', print1.includes('2728 B Street, San Diego CA 92102') && print1.includes('Taylor Tenant') && print1.includes('2026-10-30'));
	check('report shows stage “Tenant reviewed”', print1.includes('Tenant reviewed'));
	check('report lists every checklist item (Fire Extinguisher)', print1.includes('Fire Extinguisher'));
	check('report includes O comments', print1.includes('Hole in screen.'));
	check('report has O summary', print1.includes('Summary of O (Other) items'));
	check('report has move-in signature section', print1.includes('Move-in signatures'));
	check('report has move-out signature section', print1.includes('Move-out signatures'));
	check('report has manager + tenant signature lines', (print1.match(/Manager signature/g) || []).length === 2 && (print1.match(/Tenant signature/g) || []).length === 2);
	check('staff report keeps manager notes on screen only', print1.includes('PRIVATE-MARKER-7X9') && print1.includes('print:hidden'));
	check('report repeats table headings', print1.includes('table-header-group') || print1.includes('<thead>'));
	check('unmarked items render as dash (not implied OK)', print1.includes('>—</td>'));

	// ---- history + record view -----------------------------------------------
	const history = await fetch(`${APP}/dashboard/inspections`, { headers: { cookie: adminCookie } }).then((r) => r.text());
	check('history page lists the saved inspection', history.includes('Taylor Tenant'));
	check('history shows property/unit and stage', history.includes('2728 B Street') && history.includes('Tenant reviewed'));
	check('history has large New inspection button', history.includes('New inspection'));
	check('history has stacked mobile cards', history.includes('sm:hidden'));

	const record = await fetch(`${APP}/dashboard/inspections/${inspId}/record`, { headers: { cookie: adminCookie } }).then((r) => r.text());
	check('record view: tenant name as heading', record.includes('Taylor Tenant'));
	check('record view: checklist review with all sections', record.includes('Checklist review') && record.includes('Small Hallway'));
	check('record view: marked O comment inline', record.includes('Hole in screen.'));
	check('record view: unmarked items visible as dash', record.includes('>—</span>') || record.includes('—'));
	check('record view: Edit/Print/Download actions', record.includes('Edit inspection') && record.includes('Download PDF') && record.includes('Print'));
	check('record view: private manager notes labeled', record.includes('Private manager notes'));

	// ---- print view as tenant: no private notes ----------------------------------
	const tenantCookie = await appLogin('rdtest-insp-tenant@example.com');
	const printT = await fetch(`${editUrl}/print`, { headers: { cookie: tenantCookie } }).then((r) => r.text());
	check('tenant can open the report', printT.includes('Property Inspection Report'));
	check('tenant report excludes private manager notes', !printT.includes('PRIVATE-MARKER-7X9'));
	check('tenant report still shows checklist', printT.includes('Hole in screen.'));

	// ---- access control ----------------------------------------------------------
	const tenantEdit = await fetch(editUrl, { headers: { cookie: tenantCookie }, redirect: 'manual' });
	check('tenant cannot open the editor', tenantEdit.status === 303, `status ${tenantEdit.status}`);
	const tenantSave = await fetch(`${editUrl}?/saveInspection`, {
		method: 'POST', headers: { cookie: tenantCookie, accept: 'text/html' }, body: saveFd, redirect: 'manual'
	});
	check('tenant cannot save the inspection', [303, 400, 403].includes(tenantSave.status), `status ${tenantSave.status}`);
	const afterTenantPost = await su.collection('inspections').getOne(inspId);
	check(
		'tenant POST did not modify the record',
		afterTenantPost.stage === 'tenant_reviewed' &&
			afterTenantPost.checklist.find((c) => c.item === 'Doorbell / Security Device')?.moveIn?.comment === 'Nonworking doorbell.'
	);

	// ---- move-out snapshot keeps move-in observations separate -------------------
	const moFd = new FormData();
	moFd.append('lease', lease.id);
	moFd.append('type', 'move_out');
	const moCreated = await fetch(`${APP}/dashboard/inspections?/createInspection`, {
		method: 'POST', headers: { cookie: adminCookie, accept: 'text/html' }, body: moFd, redirect: 'manual'
	});
	const moId = (moCreated.headers.get('location') ?? '').split('/').pop();
	const moRec = await su.collection('inspections').getOne(moId);
	fixtures.inspections.push(moId);
	const moDoorbell = moRec.checklist.find((c) => c.item === 'Doorbell / Security Device');
	check('move-out snapshots move-in observation (O + comment)', moDoorbell?.moveIn?.condition === 'other' && moDoorbell.moveIn.comment === 'Nonworking doorbell.');
	check('move-out side starts fresh (not reviewed)', moDoorbell?.moveOut?.condition === 'not_reviewed');
	const recheck = await su.collection('inspections').getOne(inspId);
	check('move-in record unchanged by move-out creation', recheck.checklist.find((c) => c.item === 'Doorbell / Security Device')?.moveOut?.condition === 'not_reviewed');

	// ---- signed copy ---------------------------------------------------------------
	const scFd = new FormData();
	scFd.append('signed_copy', new File([PNG], 'signed.png', { type: 'image/png' }));
	const sc = await fetch(`${editUrl}?/uploadSignedCopy`, {
		method: 'POST', headers: { cookie: adminCookie, accept: 'text/html' }, body: scFd
	});
	check('upload signed copy accepted', sc.status === 200, `status ${sc.status}`);
	const withCopy = await su.collection('inspections').getOne(inspId);
	check('signed copy stored on the record', typeof withCopy.signed_copy === 'string' && withCopy.signed_copy.length > 0);
	const fileRes = await fetch(`${APP}/files/inspections/${inspId}/${withCopy.signed_copy}`, {
		headers: { cookie: adminCookie }, redirect: 'manual'
	});
    // The app route proxies the bytes (200) rather than redirecting (302): verify
    // the actual content comes back, not just the status.
    const fileBody = new Uint8Array(await fileRes.arrayBuffer());
    check(
            'signed copy downloads via authenticated app proxy (real bytes)',
            fileRes.status === 200 &&
                    (fileRes.headers.get('content-type') ?? '').includes('image/png') &&
                    PNG.slice(0, 8).every((b, i) => fileBody[i] === b),
            `status ${fileRes.status}, type ${fileRes.headers.get('content-type')}, bytes ${fileBody.length}`
    );
    const anonFile = await fetch(`${APP}/files/inspections/${inspId}/${withCopy.signed_copy}`, { redirect: 'manual' });
    check('anon cannot download signed copy', anonFile.status === 401, `status ${anonFile.status}`);

	// ---- signatures -------------------------------------------------------------
	const signFd = (who, name, withAck, withSig) => {
		const fd = new FormData();
		fd.append(`${who}_name`, name);
		if (withAck) fd.append(`${who}_ack`, 'on');
		if (withSig) fd.append(`${who}_file`, new File([PNG], `${who}-sig.png`, { type: 'image/png' }));
		return fd;
	};

	const noAck = await fetch(`${editUrl}?/signLandlord`, {
		method: 'POST', headers: { cookie: adminCookie, accept: 'text/html' }, body: signFd('landlord', 'Dana Manager', false, true)
	});
	check('signing without acknowledgement is rejected', noAck.status === 400, `status ${noAck.status}`);

	const noSig = await fetch(`${editUrl}?/signLandlord`, {
		method: 'POST', headers: { cookie: adminCookie, accept: 'text/html' }, body: signFd('landlord', 'Dana Manager', true, false)
	});
	check('signing without a drawn signature is rejected', noSig.status === 400, `status ${noSig.status}`);

	const landSign = await fetch(`${editUrl}?/signLandlord`, {
		method: 'POST', headers: { cookie: adminCookie, accept: 'text/html' }, body: signFd('landlord', 'Dana Manager', true, true)
	});
	check('landlord signature accepted', landSign.status === 200, `status ${landSign.status}`);
	let rec = await su.collection('inspections').getOne(inspId);
	check('landlord signature stored with name + server timestamp', !!rec.sig_landlord && rec.sig_landlord_name === 'Dana Manager' && !!rec.sig_landlord_at);
	check('landlord meta records the staff device context', (rec.sig_landlord_meta || '').includes('staff account'));
	check('one signature does not mark the report signed', rec.stage !== 'signed');

	const tenantSign = await fetch(`${editUrl}?/signTenant`, {
		method: 'POST', headers: { cookie: adminCookie, accept: 'text/html' }, body: signFd('tenant', 'Taylor Tenant', true, true)
	});
	check('tenant signature accepted', tenantSign.status === 200, `status ${tenantSign.status}`);
	rec = await su.collection('inspections').getOne(inspId);
	check('both signatures saved -> stage signed', rec.stage === 'signed');
	check('tenant meta says in-person on manager device, not own login', (rec.sig_tenant_meta || '').includes("manager's device"));
	check('signed snapshot preserved with content', !!rec.signed_snapshot && JSON.stringify(rec.signed_snapshot).includes('Nonworking doorbell.'));

	const printSigned = await fetch(`${editUrl}/print`, { headers: { cookie: adminCookie } }).then((r) => r.text());
	check('PDF embeds signature images', printSigned.includes(`sig_`) && (printSigned.match(/Manager — Dana Manager/) || []).length === 1);
	check('PDF shows printed names and signing dates', printSigned.includes('Taylor Tenant') && printSigned.includes('Manager — Dana Manager'));
	check('PDF shows device context', printSigned.includes("manager's device"));
	check('unsigned side keeps blank lines', printSigned.includes('Move-out signatures'));

	const signAgain = await fetch(`${editUrl}?/signLandlord`, {
		method: 'POST', headers: { cookie: adminCookie, accept: 'text/html' }, body: signFd('landlord', 'Dana Manager', true, true)
	});
	check('signing a fully-signed record is rejected', signAgain.status === 400, `status ${signAgain.status}`);

	// ---- editing signed content forks a new unsigned revision --------------------
	const forkChecklist = JSON.parse(JSON.stringify(rec.signed_snapshot.checklist ?? rec.checklist));
	const forkIdx = forkChecklist.findIndex((c) => c.item === 'Doorbell / Security Device');
	forkChecklist[forkIdx].moveIn.comment = 'Nonworking doorbell (updated after signing).';
	const forkFd = new FormData();
	forkFd.append('address', '2728 B Street, San Diego CA 92102');
	forkFd.append('unit', '102');
	forkFd.append('tenant_names', 'Taylor Tenant');
	forkFd.append('move_in_date', '2026-10-30');
	forkFd.append('move_out_date', '');
	forkFd.append('date', '2026-10-30');
	forkFd.append('type', 'move_in');
	forkFd.append('stage', 'in_progress');
	forkFd.append('notes', 'General notes on the report.');
	forkFd.append('manager_notes', '');
	forkFd.append('occupancy', 'occupied');
	forkFd.append('lease_id', lease.id);
	forkFd.append('checklist', JSON.stringify(forkChecklist));
	forkFd.append('proposed_deductions', '[]');
	const forkRes = await fetch(`${editUrl}?/saveInspection`, {
		method: 'POST', headers: { cookie: adminCookie, accept: 'text/html' }, body: forkFd, redirect: 'manual'
	});
	const forkLoc = forkRes.headers.get('location') ?? '';
	const forkId = forkLoc.split('/').pop()?.split('?')[0];
	check('editing signed content redirects to a new revision', forkRes.status === 303 && forkId && forkId !== inspId, `status ${forkRes.status}`);
	const orig = await su.collection('inspections').getOne(inspId);
	check('signed original untouched (stage, snapshot, signatures)', orig.stage === 'signed' && !!orig.signed_snapshot && !!orig.sig_landlord && !!orig.sig_tenant);
	check(
		'original still has the original comment',
		JSON.stringify(orig.checklist).includes('Nonworking doorbell.') && !JSON.stringify(orig.checklist).includes('(updated after signing)')
	);
	const fork = await su.collection('inspections').getOne(forkId);
	fixtures.inspections.push(forkId);
	check('new revision is unsigned, draft, linked to signed version', fork.stage === 'draft' && !fork.sig_landlord && !fork.sig_tenant && fork.revision_of === inspId);
	check('new revision carries the edited content', JSON.stringify(fork.checklist).includes('(updated after signing)'));

	// move-out record keeps no signatures even though the move-in is signed
	const moRecheck = await su.collection('inspections').getOne(moId);
	check('move-out never reuses move-in signatures', !moRecheck.sig_landlord && !moRecheck.sig_tenant && moRecheck.stage !== 'signed');
} finally {
	for (const id of fixtures.documents) await su.collection('documents').delete(id).catch(() => {});
	for (const id of fixtures.inspections) await su.collection('inspections').delete(id).catch(() => {});
	for (const id of fixtures.leases) await su.collection('leases').delete(id).catch(() => {});
	for (const id of fixtures.users) await su.collection('users').delete(id).catch(() => {});
	console.log('\nTemporary fixtures removed.');
}

console.log(failed === 0 ? '\nAll inspection checks passed.' : `\n${failed} check(s) FAILED.`);
if (failed > 0) process.exit(1);
