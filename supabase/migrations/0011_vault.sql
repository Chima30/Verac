-- Document Vault: documents sealed in the uploader's browser (QoreSeal, ML-KEM-1024 + X25519, AES-GCM) to chosen organisation members.
-- The database stores ciphertext only. document_access decides who is shown a document; the encryption decides who can read it.
-- Adding a reader later means uploading a new sealed copy: the server cannot re-seal because it never sees the plaintext.
-- Anchoring a document's checksum on-chain is NOT implemented.

alter table documents add column title text;

drop policy docs_ins on documents;
drop policy docacc_ins on document_access;

-- Any internal member (not only procurement roles) may publish their public reading key. Same key table and same key as procurement.
create function publish_my_seal_key(p_org uuid, p_mlkem text, p_x25519 text) returns void language plpgsql security definer set search_path = public as $$
declare k org_seal_keys%rowtype;
begin
  if auth.uid() is null or not is_internal(p_org) then raise exception 'not allowed: organisation members only'; end if;
  if length(coalesce(p_mlkem, '')) <> 3136 or p_mlkem !~ '^[0-9a-fA-F]+$' or p_x25519 !~ '^[0-9a-fA-F]{64}$' then raise exception 'invalid public key'; end if;
  select * into k from org_seal_keys where organization_id = p_org and user_id = auth.uid();
  if found then
    if k.mlkem_public = lower(p_mlkem) and k.x25519_public = lower(p_x25519) then return; end if;
    raise exception 'you already published a reading key; it cannot be replaced';
  end if;
  insert into org_seal_keys(organization_id, user_id, mlkem_public, x25519_public) values (p_org, auth.uid(), lower(p_mlkem), lower(p_x25519));
  insert into audit_events(organization_id, actor, action) values (p_org, auth.uid()::text, 'vault.seal_key_published');
end $$;

-- Members who can be chosen as readers: active internal members who have published a key.
create function vault_recipients(p_org uuid) returns table(user_id uuid, role org_role, mlkem_public text, x25519_public text)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not is_internal(p_org) then raise exception 'not allowed: organisation members only'; end if;
  return query
    select k.user_id, m.role, k.mlkem_public, k.x25519_public from org_seal_keys k
    join memberships m on m.organization_id = k.organization_id and m.user_id = k.user_id and m.status = 'active'
    where k.organization_id = p_org and is_internal(p_org) and m.role not in ('vendor', 'grant_applicant')
    order by k.created_at;
end $$;

-- The id is chosen by the browser because it is bound into the encryption (purpose vault:<id>).
create function upload_vault_document(p_org uuid, p_id uuid, p_title text, p_envelope text, p_sha256 text, p_recipients uuid[]) returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r uuid;
begin
  if me is null or not is_internal(p_org) then raise exception 'not allowed: organisation members only'; end if;
  if length(trim(coalesce(p_title, ''))) not between 1 and 160 then raise exception 'title must be 1 to 160 characters'; end if;
  if length(coalesce(p_envelope, '')) < 200 or length(p_envelope) > 4000000 then raise exception 'the sealed document has an invalid size'; end if;
  if p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'invalid checksum'; end if;
  if p_recipients is null or array_length(p_recipients, 1) is null or array_length(p_recipients, 1) > 50 then raise exception 'choose 1 to 50 readers'; end if;
  if not (me = any(p_recipients)) then raise exception 'you must be one of the readers, or you could never open it again'; end if;
  foreach r in array p_recipients loop
    if not exists (select 1 from org_seal_keys k join memberships m on m.organization_id = k.organization_id and m.user_id = k.user_id and m.status = 'active'
                   where k.organization_id = p_org and k.user_id = r and m.role not in ('vendor', 'grant_applicant'))
      then raise exception 'every reader must be an active member who has published a reading key'; end if;
  end loop;
  insert into documents(id, organization_id, purpose, storage_path, ciphertext_sha256, envelope_bytes, uploaded_by, envelope, title, recipients)
  values (p_id, p_org, 'vault', 'db:envelope', p_sha256, length(p_envelope), me, p_envelope, trim(p_title), to_jsonb(p_recipients));
  insert into document_access(organization_id, document_id, user_id, granted_by) select p_org, p_id, x, me from (select distinct unnest(p_recipients) as x) s;
  insert into audit_events(organization_id, actor, action, subject, detail) values (p_org, me::text, 'vault.uploaded', p_id::text, jsonb_build_object('readers', array_length(p_recipients, 1), 'sha256', p_sha256));
end $$;

create function vault_document_envelope(p_id uuid) returns table(envelope text, envelope_sha256 text) language plpgsql security definer set search_path = public as $$
declare d documents%rowtype;
begin
  select * into d from documents where id = p_id and purpose = 'vault';
  if not found or auth.uid() is null or not exists (select 1 from document_access a where a.document_id = d.id and a.user_id = auth.uid())
    then raise exception 'not allowed: you are not a reader of this document'; end if;
  insert into audit_events(organization_id, actor, action, subject) values (d.organization_id, auth.uid()::text, 'vault.fetched', d.id::text);
  return query select d.envelope, d.ciphertext_sha256;
end $$;

-- The uploader or an owner/administrator may delete. Deleting removes the ciphertext; copies anyone already downloaded are unaffected.
create function delete_vault_document(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare d documents%rowtype; me uuid := auth.uid();
begin
  select * into d from documents where id = p_id and purpose = 'vault' for update;
  if not found or me is null or not (d.uploaded_by = me or has_role(d.organization_id, admin_roles())) then raise exception 'not allowed'; end if;
  delete from documents where id = d.id;
  insert into audit_events(organization_id, actor, action, subject, detail) values (d.organization_id, me::text, 'vault.deleted', d.id::text, jsonb_build_object('title', d.title));
end $$;

revoke all on function publish_my_seal_key(uuid, text, text), vault_recipients(uuid), upload_vault_document(uuid, uuid, text, text, text, uuid[]), vault_document_envelope(uuid), delete_vault_document(uuid) from public;
grant execute on function publish_my_seal_key(uuid, text, text), vault_recipients(uuid), upload_vault_document(uuid, uuid, text, text, text, uuid[]), vault_document_envelope(uuid), delete_vault_document(uuid) to authenticated;
