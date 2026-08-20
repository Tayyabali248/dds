// Single configuration layer for the real PTCL POMS "DDS New Customer" form
// selectors (my.ptcl.net.pk/POMS/DDSNewCustomer.aspx). Nothing else in the
// extension should hard-code one of these selectors - it should come from
// here (or, later, from a saved mapping in storage once a visual field
// selector exists).
export interface FieldMapping {
  region: string; // <select> dropdown
  exchange: string;
  name: string;
  address: string;
  contact: string;
  competition: string;
  /** Hidden inputs - these are what's actually submitted/validated. */
  latHidden: string;
  lngHidden: string;
  /** Disabled text boxes - cosmetic display only, excluded from the POST. */
  latDisplay: string;
  lngDisplay: string;
  email: string;
  /** Disabled text box the page prefills with the logged-in user's PTCL username (e.g. SDSMTR.MDTAYAI). Read-only for us. */
  salesOfficer: string;
  /** Radio button whose click triggers a real page postback (reload). */
  orderStatusRadio: string;
  /** Radio button whose click also triggers a real page postback (reload). */
  technologyRadio: string;
  submit: string;
}

export const defaultFieldMapping: FieldMapping = {
  region: '#ddlregionname',
  exchange: '#TextExchange',
  name: '#TextName',
  address: '#TextAddress',
  contact: '#TextContactNo',
  competition: '#TestCompName',
  latHidden: '#hfLatitude',
  lngHidden: '#hfLongitude',
  latDisplay: '#TxtLatitude',
  lngDisplay: '#TxtLongitude',
  email: '#TxtEmail',
  salesOfficer: '#txtSalesofficer',
  orderStatusRadio: '#rbOrderBookedNo', // "Contact Later"
  technologyRadio: '#rbODNNo', // "FF"
  submit: '#btnLogin',
};
