/**
 * Which projects are eligible for field visibility (VIS-2, Q4): not a template, not archived,
 * not a demo project. Status is never read (B5, corpus `findings/018_project_listing`).
 *
 * The rule lives in sg-widgets core. Import it from here, so a change of source is one line.
 */
export { PROJECT_ELIGIBILITY_FIELDS, eligibleProjects, isEligibleProject, type EligibilityFlags } from 'sg-widgets-core';
