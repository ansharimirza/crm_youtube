// @ts-nocheck
// Resume Generator — ported from artifact, uses Gemini via our backend for parsing.
import React, { useState, useEffect, useRef, useMemo } from 'react'
import {
  Download, FileText, Loader2, Plus, X, ChevronDown, ChevronUp,
  Sparkles, Edit3, AlertCircle, RotateCcw, Check,
} from 'lucide-react'
import { getToken } from '@/lib/api'

/* ============================================================ */
/*   SAMPLE DATA                                                */
/* ============================================================ */

const SAMPLE_RESUME_TEXT = `EMMA LARSEN
Brooklyn, NY  |  emma.larsen@gmail.com  |  (917) 555-0142  |  linkedin.com/in/emmalarsen

Multi-faceted retail executive with expertise in:
- Driving 35% YoY revenue growth across multi-unit operations
- Building and mentoring high-performance teams of 40+ associates
Project Management - Conflict Resolution - Strategic Planning - P&L Ownership - Visual Merchandising

EXPERIENCE

District Manager — Aldridge & Co., New York, NY                              Mar 2021 — Present
Oversee 12 retail locations across the tri-state region with combined annual revenue of $48M.
- Grew district revenue 35% YoY through targeted merchandising and staff training initiatives
- Reduced employee turnover from 64% to 22% by overhauling onboarding and recognition programs
- Led launch of three new store concepts, each exceeding first-year sales projections by 18%+
- Partner with marketing on regional campaigns; manage P&L, budgets, and capital expenditures

Store Manager — Aldridge & Co., Brooklyn Flagship                            Jun 2018 — Mar 2021
- Managed flagship location with $9M annual revenue and team of 45 associates
- Implemented inventory system overhaul that reduced shrink by 41%
- Won "Manager of the Year" 2020 across 80+ U.S. locations

Assistant Store Manager — J. Crew, SoHo                                       Jul 2015 — May 2018
- Supported daily operations of $14M flagship in partnership with General Manager
- Developed visual merchandising standards adopted across 12 regional stores

EDUCATION

B.A., Business Administration                                                  May 2015
New York University, Stern School of Business — New York, NY
Magna Cum Laude

CERTIFICATIONS

- Certified Retail Operations Professional (CROP), National Retail Federation, 2022
- Six Sigma Green Belt, ASQ, 2020`

const SAMPLE_DATA = {
  name: 'Emma Larsen',
  contact: {
    phone: '(917) 555-0142',
    email: 'emma.larsen@gmail.com',
    location: 'Brooklyn, NY',
    linkedin: 'linkedin.com/in/emmalarsen',
    website: '',
  },
  summary: {
    tagline: 'Multi-faceted retail executive with expertise in:',
    bullets: [
      'Driving 35% YoY revenue growth across multi-unit operations',
      'Building and mentoring high-performance teams of 40+ associates',
    ],
    skills: [
      'Project Management', 'Conflict Resolution', 'Strategic Planning',
      'P&L Ownership', 'Visual Merchandising',
    ],
  },
  experience: [
    {
      title: 'District Manager',
      company: 'Aldridge & Co.',
      location: 'New York, NY',
      start: 'Mar 2021',
      end: 'Present',
      summary: 'Oversee 12 retail locations across the tri-state region with combined annual revenue of $48M.',
      bullets: [
        'Grew district revenue 35% YoY through targeted merchandising and staff training initiatives',
        'Reduced employee turnover from 64% to 22% by overhauling onboarding and recognition programs',
        'Led launch of three new store concepts, each exceeding first-year sales projections by 18%+',
        'Partner with marketing on regional campaigns; manage P&L, budgets, and capital expenditures',
      ],
    },
    {
      title: 'Store Manager',
      company: 'Aldridge & Co.',
      location: 'Brooklyn Flagship',
      start: 'Jun 2018',
      end: 'Mar 2021',
      summary: '',
      bullets: [
        'Managed flagship location with $9M annual revenue and team of 45 associates',
        'Implemented inventory system overhaul that reduced shrink by 41%',
        'Won "Manager of the Year" 2020 across 80+ U.S. locations',
      ],
    },
    {
      title: 'Assistant Store Manager',
      company: 'J. Crew',
      location: 'SoHo, NY',
      start: 'Jul 2015',
      end: 'May 2018',
      summary: '',
      bullets: [
        'Supported daily operations of $14M flagship in partnership with General Manager',
        'Developed visual merchandising standards adopted across 12 regional stores',
      ],
    },
  ],
  education: [
    {
      degree: 'B.A., Business Administration',
      school: 'New York University, Stern School of Business',
      location: 'New York, NY',
      date: 'May 2015',
      honors: 'Magna Cum Laude',
    },
  ],
  certifications: [
    { name: 'Certified Retail Operations Professional (CROP)', org: 'National Retail Federation', date: '2022' },
    { name: 'Six Sigma Green Belt', org: 'ASQ', date: '2020' },
  ],
  projects: [],
  awards: [],
}

const EMPTY_RESUME = {
  name: '',
  contact: { phone: '', email: '', location: '', linkedin: '', website: '' },
  summary: { tagline: '', bullets: [], skills: [] },
  experience: [],
  education: [],
  certifications: [],
  projects: [],
  awards: [],
}

/* ============================================================ */
/*   TEMPLATE CONFIGS                                           */
/* ============================================================ */

const SERIF_DISPLAY = '"EB Garamond", Garamond, "Hoefler Text", Cambria, Georgia, serif'
const SERIF_BODY    = '"EB Garamond", Garamond, Cambria, Georgia, serif'
const SERIF_GEORGIA = 'Georgia, "Iowan Old Style", Cambria, serif'
const SERIF_CAMBRIA = 'Cambria, Cardo, Georgia, serif'
const SANS_BODY     = '"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif'
const SANS_HUMANIST = 'Calibri, "Source Sans 3", "Source Sans Pro", "Segoe UI", sans-serif'
const MONO_FACE     = '"JetBrains Mono", "IBM Plex Mono", Menlo, Consolas, monospace'

const TEMPLATES = {
  'corporate-boardroom': {
    label: 'The Boardroom', blurb: 'Centered, banner headers, navy quarter-circle.',
    category: 'corporate', accent: '#1B2B47',
    nameFont: SERIF_DISPLAY, bodyFont: SERIF_BODY,
    nameAlign: 'center', nameStyle: 'uppercase-tracked',
    sectionStyle: 'banner', decorativeMark: 'corner-arc',
    italicTagline: true, density: 'normal',
  },
  'corporate-partner': {
    label: 'The Partner', blurb: 'Left-aligned name with hairline rule, small-caps headers.',
    category: 'corporate', accent: '#1B2B47',
    nameFont: SERIF_DISPLAY, bodyFont: SERIF_BODY,
    nameAlign: 'left', nameStyle: 'uppercase-tracked',
    sectionStyle: 'small-caps-rule', decorativeMark: 'name-rule',
    italicTagline: true, density: 'normal', tabularDates: true,
  },
  'tech-builder': {
    label: 'The Builder', blurb: 'Sans-serif throughout, small uppercase headers with thin rule.',
    category: 'tech', accent: '#3B5168',
    nameFont: SANS_BODY, bodyFont: SANS_BODY,
    nameAlign: 'left', nameStyle: 'sans-bold',
    sectionStyle: 'small-caps-rule', decorativeMark: 'name-rule',
    italicTagline: false, density: 'normal', monoSkills: true,
  },
  'tech-architect': {
    label: 'The Architect', blurb: 'Centered sans-serif, slate banners, inline tech pills.',
    category: 'tech', accent: '#3B5168',
    nameFont: SANS_BODY, bodyFont: SANS_BODY,
    nameAlign: 'center', nameStyle: 'sans-uppercase-tracked',
    sectionStyle: 'banner', decorativeMark: 'corner-arc',
    italicTagline: false, density: 'normal', pillSkills: true,
  },
  'creative-editorial': {
    label: 'The Editorial', blurb: 'Asymmetric: name left, contact right on same baseline.',
    category: 'creative', accent: '#A85432', accentSage: '#6B7F5C',
    nameFont: SERIF_CAMBRIA, bodyFont: SERIF_CAMBRIA,
    nameAlign: 'asymmetric', nameStyle: 'serif-display',
    sectionStyle: 'small-caps-italic', decorativeMark: 'thin-rule',
    italicTagline: true, italicRoles: true, density: 'normal', creativeTone: true,
  },
  'creative-studio': {
    label: 'The Studio', blurb: 'Centered name, italic taglines, soft tinted banners.',
    category: 'creative', accent: '#A85432', accentSage: '#6B7F5C',
    nameFont: SERIF_CAMBRIA, bodyFont: SERIF_CAMBRIA,
    nameAlign: 'center', nameStyle: 'serif-display',
    sectionStyle: 'banner-soft', decorativeMark: 'corner-arc',
    italicTagline: true, italicRoles: true, density: 'normal', creativeTone: true,
  },
  'healthcare-practitioner': {
    label: 'The Practitioner', blurb: 'Reference-style with teal banner headers.',
    category: 'healthcare', accent: '#2A6B6E',
    nameFont: SERIF_GEORGIA, bodyFont: SERIF_GEORGIA,
    nameAlign: 'center', nameStyle: 'uppercase-tracked',
    sectionStyle: 'banner', decorativeMark: 'corner-arc',
    italicTagline: true, density: 'normal', licensesProminent: true,
  },
  'healthcare-educator': {
    label: 'The Educator', blurb: 'Compact, left-aligned name with teal rule beneath.',
    category: 'healthcare', accent: '#2A6B6E',
    nameFont: SERIF_GEORGIA, bodyFont: SERIF_GEORGIA,
    nameAlign: 'left', nameStyle: 'serif-display',
    sectionStyle: 'small-caps-rule', decorativeMark: 'name-rule',
    italicTagline: true, density: 'compact',
  },
  'academic-scholar': {
    label: 'The Scholar', blurb: 'Formal centered, traditional banners, scholarly sections.',
    category: 'academic', accent: '#6B2737',
    nameFont: SERIF_DISPLAY, bodyFont: SERIF_BODY,
    nameAlign: 'center', nameStyle: 'uppercase-tracked',
    sectionStyle: 'banner', decorativeMark: 'corner-arc',
    italicTagline: true, density: 'normal',
  },
  'academic-researcher': {
    label: 'The Researcher', blurb: 'Compact CV density, small-caps with burgundy rule.',
    category: 'academic', accent: '#6B2737',
    nameFont: SERIF_DISPLAY, bodyFont: SERIF_BODY,
    nameAlign: 'left', nameStyle: 'uppercase-tracked',
    sectionStyle: 'small-caps-rule', decorativeMark: 'name-rule',
    italicTagline: true, density: 'compact', tabularDates: true,
  },
  'trades-operator': {
    label: 'The Operator', blurb: 'Bold left-aligned, charcoal banners with thin orange underline.',
    category: 'trades', accent: '#2D2D2D', accent2: '#C2511F',
    nameFont: SANS_HUMANIST, bodyFont: SANS_HUMANIST,
    nameAlign: 'left', nameStyle: 'sans-bold-uppercase',
    sectionStyle: 'banner-underline', decorativeMark: 'name-rule-orange',
    italicTagline: false, density: 'normal',
  },
  'trades-foreman': {
    label: 'The Foreman', blurb: 'Centered name, charcoal corner mark, certifications first.',
    category: 'trades', accent: '#2D2D2D', accent2: '#C2511F',
    nameFont: SANS_HUMANIST, bodyFont: SANS_HUMANIST,
    nameAlign: 'center', nameStyle: 'sans-bold-uppercase',
    sectionStyle: 'banner', decorativeMark: 'corner-arc',
    italicTagline: false, density: 'normal', licensesProminent: true,
  },
}

const CATEGORIES = [
  { id: 'corporate',  label: 'Corporate',     variants: ['corporate-boardroom', 'corporate-partner'] },
  { id: 'tech',       label: 'Tech',          variants: ['tech-builder', 'tech-architect'] },
  { id: 'creative',   label: 'Creative',      variants: ['creative-editorial', 'creative-studio'] },
  { id: 'healthcare', label: 'Health / Edu',  variants: ['healthcare-practitioner', 'healthcare-educator'] },
  { id: 'academic',   label: 'Academic',      variants: ['academic-scholar', 'academic-researcher'] },
  { id: 'trades',     label: 'Trades',        variants: ['trades-operator', 'trades-foreman'] },
]

const ACCENT_PRESETS = [
  { name: 'Navy',     value: '#1B2B47' },
  { name: 'Slate',    value: '#3B5168' },
  { name: 'Teal',     value: '#2A6B6E' },
  { name: 'Forest',   value: '#2C5530' },
  { name: 'Sage',     value: '#6B7F5C' },
  { name: 'Burgundy', value: '#6B2737' },
  { name: 'Plum',     value: '#4A2545' },
  { name: 'Clay',     value: '#A85432' },
  { name: 'Charcoal', value: '#2D2D2D' },
  { name: 'Black',    value: '#1A1A1A' },
]

/* ============================================================ */
/*   PREVIEW COMPONENTS                                         */
/* ============================================================ */

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function SectionHeader({ children, template, accent }) {
  const style = template.sectionStyle
  if (style === 'banner' || style === 'banner-underline') {
    return (
      <div style={{
        background: '#E8E8E8', padding: '0.06in 0.12in', margin: '0.18in 0 0.1in 0',
        borderBottom: style === 'banner-underline' ? `1.5px solid ${template.accent2 || accent}` : 'none',
        textAlign: 'center', letterSpacing: '0.18em', fontSize: '10pt',
        fontWeight: 600, textTransform: 'uppercase', color: accent,
      }}>{children}</div>
    )
  }
  if (style === 'banner-soft') {
    return (
      <div style={{
        background: hexToRgba(accent, 0.10), padding: '0.06in 0.12in', margin: '0.18in 0 0.1in 0',
        textAlign: 'center', letterSpacing: '0.18em', fontSize: '10pt',
        fontWeight: 500, textTransform: 'uppercase', color: accent,
      }}>{children}</div>
    )
  }
  if (style === 'small-caps-rule') {
    return (
      <div style={{
        margin: '0.2in 0 0.08in 0', paddingBottom: '0.03in',
        borderBottom: `1px solid ${accent}`, letterSpacing: '0.22em',
        fontSize: '9.5pt', fontWeight: 600, textTransform: 'uppercase', color: accent,
      }}>{children}</div>
    )
  }
  if (style === 'small-caps-italic') {
    return (
      <div style={{
        margin: '0.22in 0 0.08in 0', paddingBottom: '0.04in',
        borderBottom: `0.5px solid ${accent}`, letterSpacing: '0.16em',
        fontSize: '10pt', fontStyle: 'italic', fontWeight: 400,
        textTransform: 'uppercase', color: accent,
      }}>{children}</div>
    )
  }
  return null
}

function CornerMark({ template, accent }) {
  const mark = template.decorativeMark
  if (mark === 'thin-rule') {
    return <div aria-hidden="true" style={{
      position: 'absolute', top: '0.5in', right: '0.75in',
      width: '0.75in', height: '2px', background: accent,
    }}/>
  }
  return null
}

function ResumeHeader({ data, template, accent }) {
  const align = template.nameAlign
  const nameStyle = template.nameStyle
  let nameStyles = { fontFamily: template.nameFont, color: '#111', margin: 0 }

  if (nameStyle === 'uppercase-tracked')        nameStyles = { ...nameStyles, fontSize: '28pt', letterSpacing: '0.28em', textTransform: 'uppercase', fontWeight: 500 }
  else if (nameStyle === 'sans-uppercase-tracked') nameStyles = { ...nameStyles, fontSize: '24pt', letterSpacing: '0.32em', textTransform: 'uppercase', fontWeight: 500 }
  else if (nameStyle === 'sans-bold')           nameStyles = { ...nameStyles, fontSize: '26pt', fontWeight: 700, letterSpacing: '-0.01em' }
  else if (nameStyle === 'sans-bold-uppercase') nameStyles = { ...nameStyles, fontSize: '26pt', fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase' }
  else if (nameStyle === 'serif-display')       nameStyles = { ...nameStyles, fontSize: '30pt', fontWeight: 500, letterSpacing: '0.01em' }

  const contactItems = [data.contact.location, data.contact.phone, data.contact.email, data.contact.linkedin, data.contact.website].filter(Boolean)
  const contactStyle = { fontFamily: template.bodyFont, fontSize: '9.5pt', color: '#3a3a3a', letterSpacing: '0.02em' }

  if (align === 'center') {
    return (
      <div style={{ textAlign: 'center', marginTop: 0 }}>
        <h1 style={nameStyles}>{data.name || 'Your Name'}</h1>
        <div style={{ ...contactStyle, marginTop: '0.12in' }}>{contactItems.join('  |  ')}</div>
      </div>
    )
  }
  if (align === 'left') {
    return (
      <div style={{ textAlign: 'left', marginTop: 0 }}>
        <h1 style={nameStyles}>{data.name || 'Your Name'}</h1>
        {template.decorativeMark === 'name-rule' && (<div style={{ width: '1.4in', height: '1.5px', background: accent, marginTop: '0.06in' }} />)}
        {template.decorativeMark === 'name-rule-orange' && (<div style={{ width: '1.4in', height: '2px', background: template.accent2 || accent, marginTop: '0.08in' }} />)}
        <div style={{ ...contactStyle, marginTop: '0.12in' }}>{contactItems.join('  |  ')}</div>
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.3in', marginTop: 0 }}>
      <h1 style={nameStyles}>{data.name || 'Your Name'}</h1>
      <div style={{ ...contactStyle, textAlign: 'right', maxWidth: '3.5in', lineHeight: 1.5 }}>
        {contactItems.map((item, i) => <div key={i}>{item}</div>)}
      </div>
    </div>
  )
}

function SummarySection({ data, template, accent }) {
  const s = data.summary
  const hasContent = s && (s.tagline || (s.bullets && s.bullets.length) || (s.skills && s.skills.length))
  if (!hasContent) return null
  return (
    <div>
      <SectionHeader template={template} accent={accent}>Summary</SectionHeader>
      <div style={{ fontFamily: template.bodyFont, fontSize: '10.5pt', color: '#1c1c1c', lineHeight: 1.5 }}>
        {s.bullets?.length > 0 && (
          <ul style={{ margin: '0 0 0.08in 0', paddingLeft: '0.22in' }}>
            {s.bullets.map((b, i) => <li key={i} style={{ marginBottom: '0.04in' }}>{b}</li>)}
          </ul>
        )}
        {s.tagline && (
          <div style={{ fontStyle: template.italicTagline ? 'italic' : 'normal', margin: '0.05in 0 0.06in 0', color: '#2b2b2b' }}>
            {s.tagline}
          </div>
        )}
        {s.skills?.length > 0 && (
          <div style={{ fontFamily: template.monoSkills ? MONO_FACE : template.bodyFont, fontSize: template.monoSkills ? '9.5pt' : '10.5pt', color: '#1c1c1c', marginTop: '0.04in' }}>
            {template.pillSkills ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.06in' }}>
                {s.skills.map((sk, i) => (
                  <span key={i} style={{ border: `1px solid ${hexToRgba(accent, 0.4)}`, color: accent, padding: '0.02in 0.1in', borderRadius: '0.05in', fontSize: '9pt', letterSpacing: '0.02em' }}>{sk}</span>
                ))}
              </div>
            ) : s.skills.join('  -  ')}
          </div>
        )}
      </div>
    </div>
  )
}

function ExperienceSection({ data, template, accent }) {
  if (!data.experience?.length) return null
  return (
    <div>
      <SectionHeader template={template} accent={accent}>Experience</SectionHeader>
      <div style={{ fontFamily: template.bodyFont, fontSize: '10.5pt', color: '#1c1c1c', lineHeight: 1.5 }}>
        {data.experience.map((exp, i) => (
          <div key={i} style={{ marginBottom: i === data.experience.length - 1 ? 0 : (template.density === 'compact' ? '0.1in' : '0.16in') }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.3in' }}>
              <div style={{ fontWeight: 700, color: '#111' }}>
                {exp.title}
                {exp.company && <span style={{ fontWeight: 400 }}>{' — '}{exp.company}</span>}
                {exp.location && <span style={{ fontWeight: 400, color: '#3a3a3a' }}>{', '}{exp.location}</span>}
              </div>
              <div style={{ fontVariantNumeric: template.tabularDates ? 'tabular-nums' : 'normal', color: '#3a3a3a', whiteSpace: 'nowrap', fontSize: '10pt' }}>
                {[exp.start, exp.end].filter(Boolean).join(' — ')}
              </div>
            </div>
            {exp.summary && (
              <div style={{ fontStyle: template.italicRoles ? 'italic' : 'normal', color: '#2b2b2b', margin: '0.03in 0' }}>{exp.summary}</div>
            )}
            {exp.bullets?.length > 0 && (
              <ul style={{ margin: '0.03in 0 0 0', paddingLeft: '0.22in' }}>
                {exp.bullets.map((b, j) => <li key={j} style={{ marginBottom: '0.02in' }}>{b}</li>)}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function EducationSection({ data, template, accent }) {
  if (!data.education?.length) return null
  return (
    <div>
      <SectionHeader template={template} accent={accent}>Education</SectionHeader>
      <div style={{ fontFamily: template.bodyFont, fontSize: '10.5pt', color: '#1c1c1c', lineHeight: 1.5 }}>
        {data.education.map((ed, i) => (
          <div key={i} style={{ marginBottom: i === data.education.length - 1 ? 0 : '0.1in' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.3in' }}>
              <div style={{ fontWeight: 600, color: '#111' }}>
                {ed.degree}
                {ed.school && <span style={{ fontWeight: 400 }}>{' — '}{ed.school}</span>}
                {ed.location && <span style={{ fontWeight: 400, color: '#3a3a3a' }}>{', '}{ed.location}</span>}
              </div>
              <div style={{ fontVariantNumeric: template.tabularDates ? 'tabular-nums' : 'normal', color: '#3a3a3a', whiteSpace: 'nowrap', fontSize: '10pt' }}>{ed.date}</div>
            </div>
            {ed.honors && <div style={{ fontStyle: 'italic', color: '#3a3a3a', marginTop: '0.02in' }}>{ed.honors}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

function CertificationsSection({ data, template, accent }) {
  if (!data.certifications?.length) return null
  return (
    <div>
      <SectionHeader template={template} accent={accent}>Certifications &amp; Licenses</SectionHeader>
      <div style={{ fontFamily: template.bodyFont, fontSize: '10.5pt', color: '#1c1c1c', lineHeight: 1.5 }}>
        <ul style={{ margin: 0, paddingLeft: '0.22in' }}>
          {data.certifications.map((c, i) => (
            <li key={i} style={{ marginBottom: '0.03in' }}>
              <span style={{ fontWeight: 600 }}>{c.name}</span>
              {c.org && <span>{', '}{c.org}</span>}
              {c.date && <span style={{ color: '#3a3a3a' }}>{' ('}{c.date}{')'}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function ProjectsSection({ data, template, accent }) {
  if (!data.projects?.length) return null
  return (
    <div>
      <SectionHeader template={template} accent={accent}>Projects</SectionHeader>
      <div style={{ fontFamily: template.bodyFont, fontSize: '10.5pt', color: '#1c1c1c', lineHeight: 1.5 }}>
        {data.projects.map((p, i) => (
          <div key={i} style={{ marginBottom: i === data.projects.length - 1 ? 0 : '0.1in' }}>
            <div style={{ fontWeight: 600 }}>{p.name}</div>
            {p.description && <div style={{ color: '#2b2b2b', margin: '0.02in 0' }}>{p.description}</div>}
            {p.bullets?.length > 0 && (
              <ul style={{ margin: '0.02in 0 0 0', paddingLeft: '0.22in' }}>
                {p.bullets.map((b, j) => <li key={j}>{b}</li>)}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function AwardsSection({ data, template, accent }) {
  if (!data.awards?.length) return null
  return (
    <div>
      <SectionHeader template={template} accent={accent}>Awards &amp; Honors</SectionHeader>
      <div style={{ fontFamily: template.bodyFont, fontSize: '10.5pt', color: '#1c1c1c', lineHeight: 1.5 }}>
        <ul style={{ margin: 0, paddingLeft: '0.22in' }}>
          {data.awards.map((a, i) => <li key={i} style={{ marginBottom: '0.03in' }}>{a}</li>)}
        </ul>
      </div>
    </div>
  )
}

const TemplatePreview = React.forwardRef(function TemplatePreview({ template, data, accent, accent2 }, ref) {
  const effTemplate = useMemo(() => ({ ...template, accent2: accent2 || template.accent2 }), [template, accent2])
  return (
    <div ref={ref} className="resume-page" style={{
      width: '8.5in', minHeight: '11in', background: '#FDFCF9',
      position: 'relative', padding: '0.75in', boxSizing: 'border-box',
      fontFamily: template.bodyFont, color: '#1c1c1c', fontSize: '10.5pt', lineHeight: 1.5,
      boxShadow: '0 1px 0 rgba(0,0,0,0.04), 0 12px 30px -10px rgba(20,20,40,0.12)',
    }}>
      <CornerMark template={effTemplate} accent={accent} />
      <ResumeHeader data={data} template={effTemplate} accent={accent} />
      {template.licensesProminent && data.certifications?.length > 0 && (
        <CertificationsSection data={data} template={effTemplate} accent={accent} />
      )}
      <SummarySection data={data} template={effTemplate} accent={accent} />
      <ExperienceSection data={data} template={effTemplate} accent={accent} />
      <EducationSection data={data} template={effTemplate} accent={accent} />
      {!template.licensesProminent && <CertificationsSection data={data} template={effTemplate} accent={accent} />}
      <ProjectsSection data={data} template={effTemplate} accent={accent} />
      <AwardsSection data={data} template={effTemplate} accent={accent} />
    </div>
  )
})

/* ============================================================ */
/*   FORM PANEL                                                 */
/* ============================================================ */

const fieldClass = 'w-full px-2.5 py-1.5 text-sm border border-stone-300 rounded bg-white text-stone-900 focus:outline-none focus:border-stone-600 focus:ring-1 focus:ring-stone-600 transition-colors'
const labelClass = 'block text-[11px] uppercase tracking-wider text-stone-500 mb-1 font-medium'
const subSectionClass = 'border border-stone-200 rounded-md p-3 bg-stone-50/50'

function ListInput({ label, items, onChange, placeholder = 'Add item' }) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      <div className="space-y-1.5">
        {items.map((item, i) => (
          <div key={i} className="flex gap-1.5">
            <input className={fieldClass} value={item}
              onChange={(e) => onChange(items.map((it, idx) => idx === i ? e.target.value : it))}
              placeholder={placeholder} />
            <button onClick={() => onChange(items.filter((_, idx) => idx !== i))}
              className="px-2 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded">
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
        <button onClick={() => onChange([...items, ''])}
          className="text-xs text-stone-600 hover:text-stone-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-stone-100">
          <Plus className="w-3 h-3" /> Add
        </button>
      </div>
    </div>
  )
}

function CollapsibleSection({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-stone-200 last:border-b-0">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between py-3 text-left group">
        <span className="text-sm font-semibold tracking-wide text-stone-800 group-hover:text-stone-950">{title}</span>
        {open ? <ChevronUp className="w-4 h-4 text-stone-400" /> : <ChevronDown className="w-4 h-4 text-stone-400" />}
      </button>
      {open && <div className="pb-4 space-y-3">{children}</div>}
    </div>
  )
}

function ResumeForm({ data, setData }) {
  const update = (path, value) => {
    setData(prev => {
      const next = JSON.parse(JSON.stringify(prev))
      const parts = path.split('.')
      let cur = next
      for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]]
      cur[parts[parts.length - 1]] = value
      return next
    })
  }
  const updateExp = (i, key, val) => setData(prev => ({ ...prev, experience: prev.experience.map((e, idx) => idx === i ? { ...e, [key]: val } : e) }))
  const updateEdu = (i, key, val) => setData(prev => ({ ...prev, education: prev.education.map((e, idx) => idx === i ? { ...e, [key]: val } : e) }))
  const updateCert = (i, key, val) => setData(prev => ({ ...prev, certifications: prev.certifications.map((e, idx) => idx === i ? { ...e, [key]: val } : e) }))

  return (
    <div className="space-y-1">
      <CollapsibleSection title="Identity & Contact">
        <div>
          <label className={labelClass}>Full name</label>
          <input className={fieldClass} value={data.name} onChange={e => update('name', e.target.value)} placeholder="Your name" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className={labelClass}>Phone</label><input className={fieldClass} value={data.contact.phone} onChange={e => update('contact.phone', e.target.value)} /></div>
          <div><label className={labelClass}>Email</label><input className={fieldClass} value={data.contact.email} onChange={e => update('contact.email', e.target.value)} /></div>
          <div><label className={labelClass}>Location</label><input className={fieldClass} value={data.contact.location} onChange={e => update('contact.location', e.target.value)} /></div>
          <div><label className={labelClass}>LinkedIn</label><input className={fieldClass} value={data.contact.linkedin} onChange={e => update('contact.linkedin', e.target.value)} /></div>
          <div className="col-span-2"><label className={labelClass}>Website</label><input className={fieldClass} value={data.contact.website} onChange={e => update('contact.website', e.target.value)} /></div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Summary">
        <div><label className={labelClass}>Tagline (italic)</label><input className={fieldClass} value={data.summary.tagline} onChange={e => update('summary.tagline', e.target.value)} /></div>
        <ListInput label="Bullets" items={data.summary.bullets} onChange={v => update('summary.bullets', v)} placeholder="A summary point" />
        <ListInput label="Skills" items={data.summary.skills} onChange={v => update('summary.skills', v)} placeholder="A skill" />
      </CollapsibleSection>

      <CollapsibleSection title="Experience">
        {data.experience.map((exp, i) => (
          <div key={i} className={subSectionClass}>
            <div className="flex justify-between items-start mb-2">
              <span className="text-xs uppercase tracking-wider text-stone-500 font-medium">Role {i + 1}</span>
              <button onClick={() => setData(p => ({ ...p, experience: p.experience.filter((_, j) => j !== i) }))} className="text-stone-400 hover:text-red-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input className={fieldClass} placeholder="Title" value={exp.title} onChange={e => updateExp(i, 'title', e.target.value)} />
                <input className={fieldClass} placeholder="Company" value={exp.company} onChange={e => updateExp(i, 'company', e.target.value)} />
                <input className={fieldClass} placeholder="Location" value={exp.location} onChange={e => updateExp(i, 'location', e.target.value)} />
                <div className="grid grid-cols-2 gap-2">
                  <input className={fieldClass} placeholder="Start" value={exp.start} onChange={e => updateExp(i, 'start', e.target.value)} />
                  <input className={fieldClass} placeholder="End" value={exp.end} onChange={e => updateExp(i, 'end', e.target.value)} />
                </div>
              </div>
              <textarea className={fieldClass} rows={2} placeholder="Optional summary paragraph" value={exp.summary} onChange={e => updateExp(i, 'summary', e.target.value)} />
              <ListInput label="Bullets" items={exp.bullets} onChange={v => updateExp(i, 'bullets', v)} placeholder="A bullet point" />
            </div>
          </div>
        ))}
        <button onClick={() => setData(p => ({ ...p, experience: [...p.experience, { title: '', company: '', location: '', start: '', end: '', summary: '', bullets: [] }] }))}
          className="w-full py-2 border border-dashed border-stone-300 text-stone-600 hover:bg-stone-50 rounded text-sm flex items-center justify-center gap-1">
          <Plus className="w-4 h-4" /> Add role
        </button>
      </CollapsibleSection>

      <CollapsibleSection title="Education">
        {data.education.map((ed, i) => (
          <div key={i} className={subSectionClass}>
            <div className="flex justify-between items-start mb-2">
              <span className="text-xs uppercase tracking-wider text-stone-500 font-medium">Entry {i + 1}</span>
              <button onClick={() => setData(p => ({ ...p, education: p.education.filter((_, j) => j !== i) }))} className="text-stone-400 hover:text-red-600"><X className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input className={fieldClass} placeholder="Degree" value={ed.degree} onChange={e => updateEdu(i, 'degree', e.target.value)} />
              <input className={fieldClass} placeholder="School" value={ed.school} onChange={e => updateEdu(i, 'school', e.target.value)} />
              <input className={fieldClass} placeholder="Location" value={ed.location} onChange={e => updateEdu(i, 'location', e.target.value)} />
              <input className={fieldClass} placeholder="Date" value={ed.date} onChange={e => updateEdu(i, 'date', e.target.value)} />
              <input className={fieldClass + ' col-span-2'} placeholder="Honors (optional)" value={ed.honors} onChange={e => updateEdu(i, 'honors', e.target.value)} />
            </div>
          </div>
        ))}
        <button onClick={() => setData(p => ({ ...p, education: [...p.education, { degree: '', school: '', location: '', date: '', honors: '' }] }))}
          className="w-full py-2 border border-dashed border-stone-300 text-stone-600 hover:bg-stone-50 rounded text-sm flex items-center justify-center gap-1">
          <Plus className="w-4 h-4" /> Add education
        </button>
      </CollapsibleSection>

      <CollapsibleSection title="Certifications" defaultOpen={false}>
        {data.certifications.map((c, i) => (
          <div key={i} className={subSectionClass}>
            <div className="flex justify-between items-start mb-2">
              <span className="text-xs uppercase tracking-wider text-stone-500 font-medium">Certification {i + 1}</span>
              <button onClick={() => setData(p => ({ ...p, certifications: p.certifications.filter((_, j) => j !== i) }))} className="text-stone-400 hover:text-red-600"><X className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <input className={fieldClass + ' col-span-2'} placeholder="Name" value={c.name} onChange={e => updateCert(i, 'name', e.target.value)} />
              <input className={fieldClass} placeholder="Date" value={c.date} onChange={e => updateCert(i, 'date', e.target.value)} />
              <input className={fieldClass + ' col-span-3'} placeholder="Issuing organization" value={c.org} onChange={e => updateCert(i, 'org', e.target.value)} />
            </div>
          </div>
        ))}
        <button onClick={() => setData(p => ({ ...p, certifications: [...p.certifications, { name: '', org: '', date: '' }] }))}
          className="w-full py-2 border border-dashed border-stone-300 text-stone-600 hover:bg-stone-50 rounded text-sm flex items-center justify-center gap-1">
          <Plus className="w-4 h-4" /> Add certification
        </button>
      </CollapsibleSection>

      <CollapsibleSection title="Awards" defaultOpen={false}>
        <ListInput label="Awards & Honors" items={data.awards} onChange={v => update('awards', v)} placeholder="An award or honor" />
      </CollapsibleSection>
    </div>
  )
}

/* ============================================================ */
/*   EXPORT HELPERS                                             */
/* ============================================================ */

function escapeHtml(s) {
  if (s == null) return ''
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.rel = 'noopener'; a.style.display = 'none'
  document.body.appendChild(a); a.click()
  setTimeout(() => { if (a.parentNode) a.parentNode.removeChild(a); URL.revokeObjectURL(url) }, 1500)
}

function exportToPDF(printAreaEl, data) {
  if (!printAreaEl) return
  const resumeHTML = printAreaEl.innerHTML
  const fullDoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(data.name || 'Resume')}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap">
<style>
  @page { size: letter; margin: 0; }
  html, body { margin: 0; padding: 0; background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .resume-page { box-shadow: none !important; margin: 0 !important; }
  @media print { body { background: white; } }
</style></head><body>${resumeHTML}<script>
  (function() {
    function go() { try { window.focus(); window.print(); } catch (e) { console.error(e); } }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function() { setTimeout(go, 100); });
    else setTimeout(go, 600);
  })();
</script></body></html>`
  const w = window.open('', '_blank', 'width=900,height=1100')
  if (!w) {
    const blob = new Blob([fullDoc], { type: 'text/html;charset=utf-8' })
    downloadBlob(blob, ((data.name || 'resume').replace(/[^a-z0-9]+/gi, '_').toLowerCase()) + '.html')
    alert('Popup diblok. Kami download HTML — buka filenya lalu Cmd/Ctrl+P untuk Save as PDF.')
    return
  }
  w.document.open(); w.document.write(fullDoc); w.document.close()
}

function rtfEscape(s) {
  if (s == null) return ''
  return String(s).replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}')
    .replace(/[-￿]/g, (c) => `\\u${c.charCodeAt(0)}?`)
    .replace(/\t/g, '\\tab ').replace(/\n/g, '\\line ')
}

function hexToRtfColor(hex) {
  const h = (hex || '#000000').replace('#', '')
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) }
}

function exportToWord(data, template, accent, accent2, name) {
  const filename = (name || 'resume').replace(/[^a-z0-9]+/gi, '_').toLowerCase() + '.rtf'
  const accentRGB = hexToRtfColor(accent)
  const accent2RGB = accent2 ? hexToRtfColor(accent2) : null
  let colorTable = `{\\colortbl;\\red17\\green17\\blue17;\\red60\\green60\\blue60;\\red232\\green232\\blue232;\\red${accentRGB.r}\\green${accentRGB.g}\\blue${accentRGB.b};`
  if (accent2RGB) colorTable += `\\red${accent2RGB.r}\\green${accent2RGB.g}\\blue${accent2RGB.b};`
  colorTable += '}'

  const useSerif = template.bodyFont.includes('Garamond') || template.bodyFont.includes('Cambria') || template.bodyFont.includes('Georgia')
  const fontTable = useSerif
    ? `{\\fonttbl{\\f0\\froman\\fcharset0 Garamond;}{\\f1\\fswiss\\fcharset0 Arial;}}`
    : `{\\fonttbl{\\f0\\fswiss\\fcharset0 Arial;}{\\f1\\froman\\fcharset0 Garamond;}}`

  const out = []
  out.push(`{\\rtf1\\ansi\\ansicpg1252\\deff0\\nouicompat`)
  out.push(fontTable); out.push(colorTable)
  out.push(`\\paperw12240\\paperh15840\\margl1080\\margr1080\\margt1080\\margb1080`)
  out.push(`\\f0\\fs22\\cf1`)

  if (data.name) {
    const align = template.nameAlign === 'left' || template.nameAlign === 'asymmetric' ? '\\ql' : '\\qc'
    const nameUpper = template.nameStyle?.includes('uppercase') || template.nameStyle?.includes('tracked')
    const nameSize = nameUpper ? 48 : 56
    const nameText = nameUpper ? data.name.toUpperCase() : data.name
    out.push(`{\\pard${align}\\sb0\\sa120\\fs${nameSize}\\b\\cf1 ${rtfEscape(nameText)}\\par}`)
  }

  const contactItems = [data.contact.location, data.contact.phone, data.contact.email, data.contact.linkedin, data.contact.website].filter(Boolean)
  if (contactItems.length) {
    const align = template.nameAlign === 'left' || template.nameAlign === 'asymmetric' ? '\\ql' : '\\qc'
    out.push(`{\\pard${align}\\sb0\\sa240\\fs19\\cf2 ${rtfEscape(contactItems.join('  |  '))}\\par}`)
  }

  const sectionHeader = (text) => {
    const isBanner = ['banner', 'banner-soft', 'banner-underline'].includes(template.sectionStyle)
    if (isBanner) {
      out.push(`{\\pard\\qc\\sb240\\sa120\\cbpat3\\cf4\\fs20\\b ${rtfEscape(text.toUpperCase())}\\b0\\par}`)
    } else {
      out.push(`{\\pard\\ql\\sb240\\sa60\\cf4\\fs19\\b ${rtfEscape(text.toUpperCase())}\\b0\\par}`)
      out.push(`{\\pard\\ql\\sb0\\sa120\\brdrb\\brdrs\\brdrw10\\brdrcf4\\par}`)
    }
  }

  const s = data.summary || {}
  if (s.tagline || s.bullets?.length || s.skills?.length) {
    sectionHeader('Summary')
    if (s.bullets?.length) s.bullets.forEach(b => out.push(`{\\pard\\fi-280\\li360\\sa60\\cf1\\fs22 \\u8226? \\tab ${rtfEscape(b)}\\par}`))
    if (s.tagline) out.push(`{\\pard\\ql\\sa60\\cf1\\fs22\\i ${rtfEscape(s.tagline)}\\i0\\par}`)
    if (s.skills?.length) out.push(`{\\pard\\ql\\sa120\\cf1\\fs22 ${rtfEscape(s.skills.join('  -  '))}\\par}`)
  }

  if (data.experience?.length) {
    sectionHeader('Experience')
    data.experience.forEach(exp => {
      const titleLine = [
        exp.title ? `{\\b ${rtfEscape(exp.title)}\\b0}` : '',
        exp.company ? ` \\u8212? ${rtfEscape(exp.company)}` : '',
        exp.location ? `, ${rtfEscape(exp.location)}` : '',
      ].join('')
      const dateRange = [exp.start, exp.end].filter(Boolean).join(' \\u8212? ')
      out.push(`{\\pard\\ql\\sb120\\sa40\\tx9000\\tqr\\tx9000\\cf1\\fs22 ${titleLine}\\tab ${rtfEscape(dateRange)}\\par}`)
      if (exp.summary) {
        const italic = template.italicRoles ? '\\i' : ''
        const italicEnd = template.italicRoles ? '\\i0' : ''
        out.push(`{\\pard\\ql\\sa40\\cf1\\fs22 ${italic}${rtfEscape(exp.summary)}${italicEnd}\\par}`)
      }
      exp.bullets?.forEach(b => out.push(`{\\pard\\fi-280\\li360\\sa30\\cf1\\fs22 \\u8226? \\tab ${rtfEscape(b)}\\par}`))
      out.push(`{\\pard\\sb60\\par}`)
    })
  }

  if (data.education?.length) {
    sectionHeader('Education')
    data.education.forEach(ed => {
      const line = [
        ed.degree ? `{\\b ${rtfEscape(ed.degree)}\\b0}` : '',
        ed.school ? ` \\u8212? ${rtfEscape(ed.school)}` : '',
        ed.location ? `, ${rtfEscape(ed.location)}` : '',
      ].join('')
      out.push(`{\\pard\\ql\\sb80\\sa40\\tx9000\\tqr\\tx9000\\cf1\\fs22 ${line}\\tab ${rtfEscape(ed.date || '')}\\par}`)
      if (ed.honors) out.push(`{\\pard\\ql\\sa40\\cf2\\fs21\\i ${rtfEscape(ed.honors)}\\i0\\par}`)
    })
  }

  if (data.certifications?.length) {
    sectionHeader('Certifications & Licenses')
    data.certifications.forEach(c => {
      const parts = [
        c.name ? `{\\b ${rtfEscape(c.name)}\\b0}` : '',
        c.org ? `, ${rtfEscape(c.org)}` : '',
        c.date ? ` (${rtfEscape(c.date)})` : '',
      ].join('')
      out.push(`{\\pard\\fi-280\\li360\\sa40\\cf1\\fs22 \\u8226? \\tab ${parts}\\par}`)
    })
  }

  if (data.projects?.length) {
    sectionHeader('Projects')
    data.projects.forEach(p => {
      if (p.name) out.push(`{\\pard\\ql\\sb80\\sa40\\cf1\\fs22\\b ${rtfEscape(p.name)}\\b0\\par}`)
      if (p.description) out.push(`{\\pard\\ql\\sa40\\cf1\\fs22 ${rtfEscape(p.description)}\\par}`)
      p.bullets?.forEach(b => out.push(`{\\pard\\fi-280\\li360\\sa30\\cf1\\fs22 \\u8226? \\tab ${rtfEscape(b)}\\par}`))
    })
  }

  if (data.awards?.length) {
    sectionHeader('Awards & Honors')
    data.awards.forEach(a => out.push(`{\\pard\\fi-280\\li360\\sa40\\cf1\\fs22 \\u8226? \\tab ${rtfEscape(a)}\\par}`))
  }

  out.push(`}`)
  const blob = new Blob([out.join('\n')], { type: 'application/rtf' })
  downloadBlob(blob, filename)
}

/* ============================================================ */
/*   PARSE — call our backend (Gemini)                          */
/* ============================================================ */

async function parseResumeWithBackend(rawText) {
  const res = await fetch('/api/resume/parse', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify({ text: rawText }),
  })
  const data = await res.json()
  if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data.resume
}

/* ============================================================ */
/*   MAIN COMPONENT                                             */
/* ============================================================ */

const TOOL_FONTS_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Inter:wght@400;500;600;700;800&family=Cormorant+Garamond:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
  .tool-display { font-family: 'Cormorant Garamond', 'EB Garamond', Garamond, serif; }
  .tool-body { font-family: 'Inter', system-ui, sans-serif; }
  .pdf-print-area { position: absolute; left: -99999px; top: 0; width: 8.5in; pointer-events: none; }
  .preview-scroll::-webkit-scrollbar { width: 10px; height: 10px; }
  .preview-scroll::-webkit-scrollbar-track { background: transparent; }
  .preview-scroll::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.15); border-radius: 5px; }
  .preview-scroll::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.25); }
`

export function ResumePage() {
  const [step, setStep] = useState('empty')
  const [rawText, setRawText] = useState('')
  const [data, setData] = useState(EMPTY_RESUME)
  const [selectedTemplate, setSelectedTemplate] = useState('corporate-boardroom')
  const [activeCategory, setActiveCategory] = useState('corporate')
  const [parseError, setParseError] = useState(null)
  const [accentOverrides, setAccentOverrides] = useState({})
  const [isExporting, setIsExporting] = useState(null)
  const [previewScale, setPreviewScale] = useState(0.78)
  const [previewHeight, setPreviewHeight] = useState(11 * 96)
  const previewRef = useRef(null)
  const previewWrapRef = useRef(null)
  const printAreaRef = useRef(null)

  useEffect(() => {
    const fit = () => {
      if (!previewWrapRef.current) return
      const w = previewWrapRef.current.clientWidth
      const targetW = 8.5 * 96
      const next = Math.min(1, (w - 32) / targetW)
      setPreviewScale(Math.max(0.35, next))
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [step])

  useEffect(() => {
    if (!previewRef.current) return
    const el = previewRef.current
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setPreviewHeight(entry.contentRect.height + 32)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [step, selectedTemplate, data])

  const template = TEMPLATES[selectedTemplate]
  const overrides = accentOverrides[selectedTemplate] || {}
  const effectiveAccent = overrides.accent || template.accent
  const effectiveAccent2 = overrides.accent2 || template.accent2
  const hasOverride = !!(overrides.accent || overrides.accent2)

  const setAccent = (color) => setAccentOverrides(prev => ({ ...prev, [selectedTemplate]: { ...(prev[selectedTemplate] || {}), accent: color } }))
  const setAccent2 = (color) => setAccentOverrides(prev => ({ ...prev, [selectedTemplate]: { ...(prev[selectedTemplate] || {}), accent2: color } }))
  const resetAccent = () => setAccentOverrides(prev => { const next = { ...prev }; delete next[selectedTemplate]; return next })

  const pickCategory = (catId) => {
    setActiveCategory(catId)
    const cat = CATEGORIES.find(c => c.id === catId)
    if (cat && !cat.variants.includes(selectedTemplate)) setSelectedTemplate(cat.variants[0])
  }

  const handleParse = async () => {
    if (!rawText.trim()) return
    setStep('parsing')
    setParseError(null)
    try {
      const parsed = await parseResumeWithBackend(rawText)
      setData(parsed)
      setStep('edit')
    } catch (err) {
      console.error('Parse error:', err)
      setParseError(`Parsing gagal: ${err?.message || 'unknown'}. Isi manual di form di kiri.`)
      setData(EMPTY_RESUME)
      setStep('edit')
    }
  }

  const handleSample = () => {
    setRawText(SAMPLE_RESUME_TEXT)
    setData(SAMPLE_DATA)
    setStep('edit')
  }

  const handleStartOver = () => {
    setData(EMPTY_RESUME); setRawText(''); setStep('empty'); setParseError(null)
  }

  const handleExportPDF = () => {
    setIsExporting('pdf')
    try { exportToPDF(printAreaRef.current, data) }
    catch (err) { alert('PDF export gagal: ' + (err?.message || '')) }
    finally { setTimeout(() => setIsExporting(null), 500) }
  }

  const handleExportDocx = () => {
    setIsExporting('docx')
    try { exportToWord(data, template, effectiveAccent, effectiveAccent2, data.name) }
    catch (err) { alert('Word export gagal') }
    finally { setTimeout(() => setIsExporting(null), 400) }
  }

  if (step === 'empty') {
    return (
      <div className="-m-4 md:-m-8 min-h-[calc(100vh-3.5rem)]" style={{ background: '#FAF7F0' }}>
        <style>{TOOL_FONTS_CSS}</style>
        <div className="max-w-3xl mx-auto px-6 py-16 md:py-24">
          <div className="mb-10">
            <div className="text-[11px] uppercase tracking-[0.3em] text-stone-500 mb-3 tool-body">A resume tool</div>
            <h1 className="tool-display text-5xl md:text-6xl text-stone-900 leading-[1.05] tracking-tight">
              Paste your résumé.<br/>
              <span className="italic text-stone-700">Get something beautiful.</span>
            </h1>
            <p className="tool-body text-stone-600 mt-5 max-w-xl leading-relaxed">
              Paste resume sebagai teks. AI Gemini akan parse, render ke salah satu dari 12 template profesional, lalu kamu export ke PDF atau Word — semua ATS-friendly &amp; editable.
            </p>
          </div>
          <div className="bg-white rounded-md border border-stone-300/80 shadow-sm overflow-hidden">
            <textarea value={rawText} onChange={(e) => setRawText(e.target.value)}
              placeholder="Paste résumé kamu di sini..."
              className="tool-body w-full px-5 py-4 text-sm text-stone-800 focus:outline-none resize-none"
              style={{ minHeight: '320px' }} />
            <div className="border-t border-stone-200 px-4 py-3 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 bg-stone-50/50">
              <button onClick={handleSample} className="tool-body text-sm text-stone-600 hover:text-stone-900 underline underline-offset-4 decoration-stone-300 hover:decoration-stone-600">
                Coba dengan sample resume
              </button>
              <button onClick={handleParse} disabled={!rawText.trim()}
                className="tool-body bg-stone-900 hover:bg-stone-700 disabled:bg-stone-300 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded text-sm font-medium tracking-wide flex items-center gap-2">
                <Sparkles className="w-4 h-4" /> Parse résumé
              </button>
            </div>
          </div>
          <div className="mt-10 text-xs text-stone-500 tool-body">
            <span className="uppercase tracking-[0.2em]">12 templates</span><span className="mx-3">·</span>
            <span>Corporate · Tech · Creative · Health/Edu · Academic · Trades</span>
          </div>
        </div>
      </div>
    )
  }

  if (step === 'parsing') {
    return (
      <div className="-m-4 md:-m-8 min-h-[calc(100vh-3.5rem)] flex items-center justify-center" style={{ background: '#FAF7F0' }}>
        <style>{TOOL_FONTS_CSS}</style>
        <div className="text-center">
          <Loader2 className="w-10 h-10 text-stone-700 animate-spin mx-auto mb-5" />
          <div className="tool-display text-2xl text-stone-800 italic">Reading your résumé…</div>
          <div className="tool-body text-sm text-stone-500 mt-2">Biasanya beberapa detik.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="-m-4 md:-m-8 min-h-[calc(100vh-3.5rem)]" style={{ background: '#F0EDE3' }}>
      <style>{TOOL_FONTS_CSS}</style>

      <header className="bg-white/70 backdrop-blur-sm border-b border-stone-300/70 px-4 md:px-6 py-3 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <div className="tool-display text-xl text-stone-900 italic leading-none">Résumé</div>
          <span className="hidden sm:inline text-stone-300">|</span>
          <span className="hidden sm:inline tool-body text-xs uppercase tracking-[0.2em] text-stone-500">Editor</span>
        </div>
        <button onClick={handleStartOver} className="tool-body text-xs text-stone-600 hover:text-stone-900 flex items-center gap-1.5 px-3 py-1.5 rounded hover:bg-stone-100">
          <RotateCcw className="w-3.5 h-3.5" /> Start over
        </button>
      </header>

      {parseError && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-2.5 flex items-center gap-2 text-sm text-amber-900 tool-body">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />{parseError}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)] gap-0">
        <aside className="bg-white border-r border-stone-200 lg:h-[calc(100vh-49px-3.5rem)] lg:overflow-y-auto preview-scroll">
          <div className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <Edit3 className="w-4 h-4 text-stone-500" />
              <h2 className="tool-display text-lg text-stone-900">Review &amp; edit</h2>
            </div>
            <p className="tool-body text-xs text-stone-500 mb-5 leading-relaxed">Fix parsing errors sebelum export. Preview update real-time.</p>
            <ResumeForm data={data} setData={setData} />
          </div>
        </aside>

        <main className="lg:h-[calc(100vh-49px-3.5rem)] flex flex-col overflow-hidden">
          <div className="bg-white border-b border-stone-200 px-3 md:px-5 pt-3">
            <div className="flex gap-1 overflow-x-auto preview-scroll pb-px">
              {CATEGORIES.map(cat => (
                <button key={cat.id} onClick={() => pickCategory(cat.id)}
                  className={`tool-body px-3 py-2 text-xs uppercase tracking-[0.15em] whitespace-nowrap border-b-2 transition-colors ${
                    activeCategory === cat.id ? 'border-stone-900 text-stone-900 font-medium' : 'border-transparent text-stone-500 hover:text-stone-800'
                  }`}>{cat.label}</button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 py-3">
              {CATEGORIES.find(c => c.id === activeCategory).variants.map(tplId => {
                const tpl = TEMPLATES[tplId]
                const active = tplId === selectedTemplate
                const tplAccent = (accentOverrides[tplId]?.accent) || tpl.accent
                return (
                  <button key={tplId} onClick={() => setSelectedTemplate(tplId)}
                    className={`tool-body text-left px-3.5 py-2 rounded text-xs border transition-all ${
                      active ? 'border-stone-900 bg-stone-900 text-white shadow-sm' : 'border-stone-300 bg-white text-stone-700 hover:border-stone-500'
                    }`}>
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: tplAccent }} />
                      <span className="font-medium">{tpl.label}</span>
                      {active && <Check className="w-3 h-3 ml-1" />}
                    </div>
                    <div className={`text-[10.5px] mt-0.5 leading-tight ${active ? 'text-stone-300' : 'text-stone-500'}`}>{tpl.blurb}</div>
                  </button>
                )
              })}
            </div>

            <div className="border-t border-stone-100 py-2.5 flex items-center gap-3 flex-wrap">
              <span className="tool-body text-[10px] uppercase tracking-[0.22em] text-stone-500 font-medium">Accent</span>
              <div className="flex items-center gap-1.5">
                <label className="relative w-7 h-7 rounded-full overflow-hidden border border-stone-300 cursor-pointer hover:border-stone-500">
                  <input type="color" value={effectiveAccent} onChange={(e) => setAccent(e.target.value)} className="absolute inset-0 w-full h-full cursor-pointer opacity-0" />
                  <span className="absolute inset-0 pointer-events-none" style={{ background: effectiveAccent }} />
                </label>
                <input type="text" value={effectiveAccent.toUpperCase()} onChange={(e) => {
                  const v = e.target.value.trim()
                  if (/^#?[0-9a-fA-F]{0,6}$/.test(v)) setAccent(v.startsWith('#') ? v : '#' + v)
                }} className="tool-body w-[5.5rem] px-2 py-1 text-[11px] font-mono uppercase border border-stone-300 rounded bg-white focus:outline-none focus:border-stone-600" />
              </div>
              <div className="hidden sm:flex items-center gap-1">
                {ACCENT_PRESETS.map(p => {
                  const active = effectiveAccent.toLowerCase() === p.value.toLowerCase()
                  return (
                    <button key={p.value} onClick={() => setAccent(p.value)}
                      className={`w-5 h-5 rounded-full border transition-transform hover:scale-110 ${active ? 'border-stone-900 ring-1 ring-stone-900 ring-offset-1' : 'border-stone-300'}`}
                      style={{ background: p.value }} title={p.name} />
                  )
                })}
              </div>
              {template.accent2 && (
                <>
                  <span className="text-stone-300 hidden sm:inline">|</span>
                  <span className="tool-body text-[10px] uppercase tracking-[0.22em] text-stone-500 font-medium">Underline</span>
                  <label className="relative w-7 h-7 rounded-full overflow-hidden border border-stone-300 cursor-pointer hover:border-stone-500">
                    <input type="color" value={effectiveAccent2 || '#C2511F'} onChange={(e) => setAccent2(e.target.value)} className="absolute inset-0 w-full h-full cursor-pointer opacity-0" />
                    <span className="absolute inset-0 pointer-events-none" style={{ background: effectiveAccent2 || '#C2511F' }} />
                  </label>
                </>
              )}
              {hasOverride && (
                <button onClick={resetAccent} className="tool-body ml-auto text-[11px] text-stone-600 hover:text-stone-900 underline underline-offset-2 decoration-stone-300 hover:decoration-stone-700">Reset</button>
              )}
            </div>
          </div>

          <div ref={previewWrapRef} className="flex-1 overflow-auto preview-scroll p-4 md:p-8 flex items-start justify-center" style={{ background: '#E8E4D8' }}>
            <div style={{ width: `${8.5 * previewScale}in`, height: `${previewHeight * previewScale}px`, flexShrink: 0 }}>
              <div style={{ transform: `scale(${previewScale})`, transformOrigin: 'top left', width: '8.5in' }}>
                <TemplatePreview ref={previewRef} template={template} data={data} accent={effectiveAccent} accent2={effectiveAccent2} />
              </div>
            </div>
          </div>

          <div className="border-t border-stone-200 bg-white px-4 py-3 flex items-center justify-between gap-3">
            <div className="hidden md:block">
              <div className="tool-body text-[10px] uppercase tracking-[0.2em] text-stone-500">Currently</div>
              <div className="tool-display text-base text-stone-900">{template.label}</div>
            </div>
            <div className="flex gap-2 ml-auto">
              <button onClick={handleExportDocx} disabled={isExporting !== null}
                className="tool-body bg-white border border-stone-900 text-stone-900 hover:bg-stone-100 disabled:opacity-50 px-4 py-2.5 rounded text-sm font-medium flex items-center gap-2">
                {isExporting === 'docx' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} Download Word
              </button>
              <button onClick={handleExportPDF} disabled={isExporting !== null}
                className="tool-body bg-stone-900 hover:bg-stone-700 disabled:bg-stone-400 text-white px-4 py-2.5 rounded text-sm font-medium flex items-center gap-2">
                {isExporting === 'pdf' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Download PDF
              </button>
            </div>
          </div>
        </main>
      </div>

      <div ref={printAreaRef} className="pdf-print-area" aria-hidden="true">
        <TemplatePreview template={template} data={data} accent={effectiveAccent} accent2={effectiveAccent2} />
      </div>
    </div>
  )
}
