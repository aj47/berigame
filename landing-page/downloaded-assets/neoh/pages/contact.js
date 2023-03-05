import Layout from "../src/layout/Layout";
import PageBanner from "../src/layout/PageBanner";

const Contact = () => {
  return (
    <Layout pageName={"Contact"}>
      <PageBanner pageName={"Contact"} />
      <div className="neoh_fn_contact_page">
        <div className="container">
          <div className="mw_500">
            <form
              action="/"
              method="post"
              className="contact_form"
              id="contact_form"
              autoComplete="off"
            >
              <div className="input_list">
                <ul>
                  <li>
                    <label htmlFor="name">Name</label>
                    <input id="name" type="text" placeholder="Your Name" />
                  </li>
                  <li>
                    <label htmlFor="email">Email</label>
                    <input
                      id="email"
                      type="text"
                      placeholder="youremail@mail.com"
                    />
                  </li>
                  <li>
                    <label htmlFor="subject">Subject</label>
                    <input id="subject" type="text" />
                  </li>
                  <li>
                    <label htmlFor="message">Message</label>
                    <textarea id="message" defaultValue={""} />
                  </li>
                  <li>
                    <a
                      id="send_message"
                      href="#"
                      className="neoh_fn_button only_text"
                    >
                      <span className="text">Send Message</span>
                    </a>
                  </li>
                </ul>
              </div>
              <div
                className="returnmessage"
                data-success="Your message has been received, We will contact you soon."
              />
              <div className="empty_notice">
                <span>Please Fill Required Fields</span>
              </div>
            </form>
            <div className="desc_holder">
              <p>
                Duis eu lorem ut mauris pulvinar auctor. Maecenas et dapibus
                orci, eleifend euismod justo. Quisque luctus turpis eu tristique
                feugiat.
              </p>
              <p>
                Praesent ac magna feugiat, interdum lacus ac, interdum dui.
                Pellentesque id quam quis enim malesuada rutrum. Orci varius
                natoque penatibus et magnis dis parturient montes, nascetur
                ridiculus mus.
              </p>
            </div>
            <div className="info_list">
              <ul>
                <li>
                  <p className="label">Address</p>
                  <h3 className="value">69 Queen St, Melbourne Australia</h3>
                </li>
                <li>
                  <p className="label">Phone</p>
                  <h3 className="value">
                    <a href="tel:+7068980751">(+706) 898-0751</a>
                  </h3>
                </li>
                <li>
                  <a href="mailto:example@domain.com" className="email">
                    example@domain.com
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};
export default Contact;
