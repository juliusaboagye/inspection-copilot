/** Plain-English explanations of reason codes, so reviewers know *why* the AI flagged something. */
const TEXT: Record<string, string> = {
  image_unreadable: 'The AI could not read the gauge from this photo.',
  low_confidence: 'The AI\'s repeated readings disagreed with each other.',
  robot_ai_disagree: 'The robot\'s reading and the AI\'s reading differ.',
  robot_decimal_shift: 'Robot value looks 10× off (decimal point error).',
  robot_unit_mismatch: 'Robot reported the right number with the wrong unit.',
  robot_reading_missing: 'The robot sent no reading.',
  ai_value_out_of_scale: 'The AI reading is off the gauge scale.',
  ai_unit_mismatch: 'The AI read a unit that does not fit this asset.',
  outside_normal_band: 'Value is outside the normal operating band.',
  confirm_alarm: 'High-severity alarm: please confirm before it is raised.',
};
export const explainReason = (code: string) =>
  code.startsWith('defect:') ? `Visible defect: ${code.slice(7).replace(/_/g, ' ')}.` : TEXT[code] ?? code;
