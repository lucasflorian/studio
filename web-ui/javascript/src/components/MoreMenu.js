/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import React from 'react';
import PropTypes from "prop-types";

/**
 * Bouton « ... » qui ouvre un petit menu d'options secondaires.
 * items : [{ label, icon, onClick, danger, disabled, hint }] ou { divider: true } ou { header: 'Titre' }
 */
class MoreMenu extends React.Component {

    constructor(props) {
        super(props);
        this.state = { open: false, pos: null };
        this.ref = React.createRef();
    }

    componentWillUnmount() {
        this.raised && this.raised.classList.remove('sl-raised');
        window.removeEventListener('scroll', this.close, true);
        window.removeEventListener('resize', this.close);
        document.removeEventListener('mousedown', this.onOutside);
        document.removeEventListener('keydown', this.onKey);
    }

    toggle = (e) => {
        e.stopPropagation();
        if (this.state.open) {
            this.close();
        } else {
            // Le menu est positionné en « fixed » par rapport à l'écran : il passe au-dessus
            // de tout (cartes voisines, fenêtres avec défilement...)
            const rect = this.ref.current.getBoundingClientRect();
            const up = rect.bottom + 300 > window.innerHeight && rect.top > 300;
            const pos = { right: Math.max(8, window.innerWidth - rect.right) };
            if (up) { pos.bottom = window.innerHeight - rect.top + 6; } else { pos.top = rect.bottom + 6; }
            this.raised = this.ref.current.closest('.sl-card');
            this.raised && this.raised.classList.add('sl-raised');
            this.setState({ open: true, pos });
            window.addEventListener('scroll', this.close, true);
            window.addEventListener('resize', this.close);
            document.addEventListener('mousedown', this.onOutside);
            document.addEventListener('keydown', this.onKey);
        }
    };

    close = () => {
        this.raised && this.raised.classList.remove('sl-raised');
        this.raised = null;
        this.setState({ open: false });
        window.removeEventListener('scroll', this.close, true);
        window.removeEventListener('resize', this.close);
        document.removeEventListener('mousedown', this.onOutside);
        document.removeEventListener('keydown', this.onKey);
    };

    onOutside = (e) => {
        if (this.ref.current && !this.ref.current.contains(e.target)) {
            this.close();
        }
    };

    onKey = (e) => {
        if (e.key === 'Escape') {
            this.close();
        }
    };

    onItem = (item) => (e) => {
        e.stopPropagation();
        if (item.disabled) {
            return;
        }
        this.close();
        item.onClick && item.onClick();
    };

    render() {
        const items = this.props.items.filter(Boolean);
        return (
            <div className={`sl-more ${this.props.align === 'left' ? 'sl-more-left' : ''} ${this.props.className || ''}`} ref={this.ref}>
                <button type="button"
                        className={`sl-more-btn ${this.state.open ? 'is-open' : ''}`}
                        title={this.props.title || 'Plus d\'options'}
                        aria-haspopup="true"
                        aria-expanded={this.state.open}
                        onClick={this.toggle}>
                    <span aria-hidden="true">&#8226;&#8226;&#8226;</span>
                </button>
                {this.state.open && <div className="sl-menu" role="menu" style={{position: 'fixed', ...this.state.pos}}>
                    {items.map((item, idx) => {
                        if (item.divider) {
                            return <div key={idx} className="sl-menu-divider"/>;
                        }
                        if (item.header) {
                            return <div key={idx} className="sl-menu-header">{item.header}</div>;
                        }
                        return <button key={idx}
                                       type="button"
                                       role="menuitem"
                                       className={`sl-menu-item ${item.danger ? 'is-danger' : ''} ${item.disabled ? 'is-disabled' : ''}`}
                                       title={item.hint || ''}
                                       onClick={this.onItem(item)}>
                            <span className="sl-menu-icon" aria-hidden="true">{item.icon}</span>
                            <span className="sl-menu-label">{item.label}</span>
                        </button>;
                    })}
                </div>}
            </div>
        );
    }
}

MoreMenu.propTypes = {
    items: PropTypes.array.isRequired,
    align: PropTypes.string,
    title: PropTypes.string,
    className: PropTypes.string
};

export default MoreMenu;
