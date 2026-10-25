/**
 * Identidade visual: o Manifestei é um cartório de presença.
 *
 * A cor principal é o azul-violeta do carimbo (a tinta de "confere com o
 * original"), e não vermelho nem verde-amarelo — cores que no Brasil têm leitura
 * partidária. Um app que conta gente de qualquer lado precisa parecer de
 * nenhum lado. O número de presentes usa uma grotesca condensada de cartaz
 * lambe-lambe; todo o resto é a fonte do sistema, quieta.
 */
export const color = {
  paper: '#F6F6F3',
  surface: '#FFFFFF',
  ink: '#1C1F2A',
  graphite: '#5E6270',
  rule: '#DADCE2',
  stamp: '#3343B5',
  stampSoft: '#E6E8F7',
  pending: '#9A6A00',
  pendingSoft: '#FBF1D9',
  virtual: '#5E6270',
  fraud: '#8A2B5E',
  fraudSoft: '#F6E6EE',
  focus: '#3343B5',
} as const;

export const font = {
  /** Big Shoulders: só para números e o texto do carimbo. */
  display: 'BigShoulders_800ExtraBold',
  displayBlack: 'BigShoulders_900Black',
} as const;

/** Escala tipográfica (razão ~1,25), em pt. */
export const type = {
  caption: 13,
  body: 16,
  lead: 18,
  title: 22,
  headline: 28,
  count: 88,
} as const;

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 } as const;

/** Raio por hierarquia: controles arredondam, superfícies quase não. */
export const radius = { control: 10, surface: 4 } as const;
