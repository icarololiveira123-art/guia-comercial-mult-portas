-- Match phone digits independently of punctuation and an optional +55 prefix.
create function mp_shared_private.phone_matches_search(p_contact text, p_query text)
returns boolean language plpgsql immutable parallel safe security invoker set search_path = '' as $$
declare
  v_query text := btrim(coalesce(p_query,''));
  v_digits text := regexp_replace(v_query,'[^0-9]','','g');
  v_contact text := regexp_replace(coalesce(p_contact,''),'[^0-9]','','g');
begin
  if v_query !~ '^\+?[0-9[:space:]().-]+$' or length(v_digits)<4 or (strpos(v_query,'.')>0 and length(v_digits)<8) then return false; end if;
  if v_digits ~ '^55[0-9]{10,11}$' then v_digits := substr(v_digits,3); end if;
  if v_contact ~ '^55[0-9]{10,11}$' then v_contact := substr(v_contact,3); end if;
  return strpos(v_contact,v_digits)>0;
end;
$$;
revoke all on function mp_shared_private.phone_matches_search(text,text) from public,anon,authenticated;
grant execute on function mp_shared_private.phone_matches_search(text,text) to service_role;

create or replace function mp_shared_private.quote_matches_search(p_data jsonb, p_query text)
returns boolean language sql immutable parallel safe security invoker set search_path = '' as $$
  select case when btrim(coalesce(p_query,''))='' then true
    when mp_shared_private.phone_matches_search(p_data->>'contact',p_query) then true
    else exists (
    select 1 from jsonb_array_elements(case when jsonb_typeof(p_data->'items')='array' and jsonb_array_length(p_data->'items')>0 then p_data->'items' else '[{}]'::jsonb end) item
    where mp_shared_private.search_text_matches(
      concat_ws(' ',p_data->>'clientName',p_data->>'contact',p_data->>'notes',item->>'description',item->>'height',item->>'width',item->>'measurements',item->>'details'),
      p_query,concat_ws(' ',item->>'height',item->>'width',item->>'measurements'))
  ) end;
$$;

do $phone_acceptance$
declare c jsonb; contact text; q text; sample jsonb := $sample${"clientName":"João Café","contact":"16981234567","notes":"Entrega na obra","items":[{"description":"Porta integrada 2 folhas","height":"2,30 m","width":"2,00 m","measurements":"","details":"Preto | Vidro temperado"},{"description":"Janela","height":"1,20 m","width":"1,50 m","measurements":"","details":"Branco"}]}$sample$::jsonb;
begin
 for c in select jsonb_array_elements($cases$[["",true],["   ",true],["joao cafe",true],["CAFÉ",true],["cafe joao",true],["integrada",true],["temperado preto",true],["2,30",true],["2.30",true],["2.3 m",true],["2,30 x 2,00",true],["2.300 × 2.000",true],["2,30Ax2,00L",true],["Altura 2,30 largura 2,00",true],["230 × 200 cm",true],["230cm x 200cm",true],["2300 mm x 2000 mm",true],["João porta 230 cm",true],["2,35",false],["0,30",false],["1,2 x 2,3",false],["2,30 x 2,30",false],["2,30 x 1,50",false],["2,30 branco",false],["não existe",false],["%",false],["_",false],["16981234567",true],["entrega obra",true],["porta 3 folhas",false],["(16) 98123-4567",true],["16 98123 4567",true],["+55 (16) 98123-4567",true],["16.98123.4567",true],["981234567",true],["4567",true],["98123-0000",false],["(11) 98123-4567",false]]$cases$::jsonb) loop
  assert mp_shared_private.quote_matches_search(sample,c->>0)=(c->>1)::boolean, 'Search case failed: ' || (c->>0);
 end loop;
 foreach contact in array array['16981234567','(16) 98123-4567','+55 (16) 98123-4567'] loop
  foreach q in array array['16981234567','(16) 98123-4567','+55 16 98123 4567','981234567','4567'] loop
   assert mp_shared_private.phone_matches_search(contact,q), 'Phone format failed';
  end loop;
  assert not mp_shared_private.phone_matches_search(contact,'11981234567'), 'Wrong DDD matched';
  assert not mp_shared_private.phone_matches_search(contact,'2.300'), 'Dimension confused with partial phone';
 end loop;
 assert not has_function_privilege('anon','mp_shared_private.phone_matches_search(text,text)','execute'), 'Phone helper exposed';
 assert not has_function_privilege('authenticated','mp_shared_private.phone_matches_search(text,text)','execute'), 'Phone helper exposed';
end;
$phone_acceptance$;

