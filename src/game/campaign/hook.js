// Ponto único de entrada da campanha original (o main.js importa este módulo
// sob demanda; os arquivos do jogo vêm sempre da instalação do jogador).

export { CampaignRuntime } from './io.js';
export { CAMPAIGN, dialogue, realCoreModel } from './index.js';
export { coreModel } from './boss.js';
export { loadCredits, playCredits } from './credits.js';
export { useDirectoryHandle, usePackBlob, forgetSource } from './source.js';
