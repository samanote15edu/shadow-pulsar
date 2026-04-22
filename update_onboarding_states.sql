-- Actualizar los estados de registro permitidos
ALTER TABLE registration_states DROP CONSTRAINT IF EXISTS registration_states_step_check;
ALTER TABLE registration_states ADD CONSTRAINT registration_states_step_check 
CHECK (step IN (
    'awaiting_invite_code', 
    'awaiting_company_name', 
    'awaiting_owner_name_for_new_store', 
    'awaiting_onboarding_confirm',
    'awaiting_fiado_name_guided',
    'awaiting_fiado_items_guided',
    'awaiting_item_qty',
    'awaiting_item_price',
    'awaiting_fiado_approval'
));
