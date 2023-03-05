import Link from "next/link";
import { useEffect, useState } from "react";
import Layout from "../src/layout/Layout";
import PageBanner from "../src/layout/PageBanner";
import { getPagination, pagination } from "../src/utilits";

const Blog = () => {
  let sort = 3;
  const [active, setActive] = useState(1);
  const [state, setstate] = useState([]);
  useEffect(() => {
    let list = document.querySelectorAll(".neoh_fn_moving_blog ul li");
    pagination(".neoh_fn_moving_blog ul li", sort, active);
    setstate(getPagination(list.length, sort));
  }, [active]);
  return (
    <Layout pageName={"Blog"}>
      <PageBanner pageName={"Blog"} />
      <div className="neoh_fn_blog_page">
        <div className="container">
          {/* Moving Blog List Shortcode */}
          <div className="neoh_fn_moving_blog">
            <ul>
              <li>
                <div className="item">
                  <img src="img/blog/1.jpg" alt="" className="moving_img" />
                  <p className="fn_date">
                    <span>June 01, 2022</span>
                  </p>
                  <h3 className="fn_title">
                    <Link href="/blog-single">
                      Neoh’s NFT Goes Public In Nod To Crypto Adoption
                    </Link>
                  </h3>
                  <p className="fn_desc">
                    Morbi non dignissim erat, a blandit felis nec lorem vel orci
                    varius congue ut vitae est.
                  </p>
                  <p className="fn_read">
                    <Link href="/blog-single">
                      <a className="neoh_fn_button only_text">
                        <span className="text">Read More</span>
                      </a>
                    </Link>
                  </p>
                </div>
              </li>
              <li>
                <div className="item">
                  <img src="img/blog/2.jpg" alt="" className="moving_img" />
                  <p className="fn_date">
                    <span>May 25, 2022</span>
                  </p>
                  <h3 className="fn_title">
                    <Link href="/blog-single">
                      Bankman-Fried Would Like to Talk With Musk About Twitter
                    </Link>
                  </h3>
                  <p className="fn_desc">
                    Morbi non dignissim erat, a blandit felis nec lorem vel orci
                    varius congue ut vitae est.
                  </p>
                  <p className="fn_read">
                    <Link href="/blog-single">
                      <a className="neoh_fn_button only_text">
                        <span className="text">Read More</span>
                      </a>
                    </Link>
                  </p>
                </div>
              </li>
              <li>
                <div className="item">
                  <img src="img/blog/3.jpg" alt="" className="moving_img" />
                  <p className="fn_date">
                    <span>May 13, 2022</span>
                  </p>
                  <h3 className="fn_title">
                    <Link href="/blog-single">
                      Crypto-Focused Silvergate Jumps on Blowout Earnings Report
                    </Link>
                  </h3>
                  <p className="fn_desc">
                    Morbi non dignissim erat, a blandit felis nec lorem vel orci
                    varius congue ut vitae est.
                  </p>
                  <p className="fn_read">
                    <Link href="/blog-single">
                      <a className="neoh_fn_button only_text">
                        <span className="text">Read More</span>
                      </a>
                    </Link>
                  </p>
                </div>
              </li>
              <li>
                <div className="item">
                  <img src="img/blog/4.jpg" alt="" className="moving_img" />
                  <p className="fn_date">
                    <span>May 08, 2022</span>
                  </p>
                  <h3 className="fn_title">
                    <Link href="/blog-single">
                      Neoh’s NFT Goes Public In Nod To Crypto Adoption
                    </Link>
                  </h3>
                  <p className="fn_desc">
                    Morbi non dignissim erat, a blandit felis nec lorem vel orci
                    varius congue ut vitae est.
                  </p>
                  <p className="fn_read">
                    <Link href="/blog-single">
                      <a className="neoh_fn_button only_text">
                        <span className="text">Read More</span>
                      </a>
                    </Link>
                  </p>
                </div>
              </li>
              <li>
                <div className="item">
                  <img src="img/blog/5.jpg" alt="" className="moving_img" />
                  <p className="fn_date">
                    <span>April 19, 2022</span>
                  </p>
                  <h3 className="fn_title">
                    <Link href="/blog-single">
                      Bankman-Fried Would Like to Talk With Musk About Twitter
                    </Link>
                  </h3>
                  <p className="fn_desc">
                    Morbi non dignissim erat, a blandit felis nec lorem vel orci
                    varius congue ut vitae est.
                  </p>
                  <p className="fn_read">
                    <Link href="/blog-single">
                      <a className="neoh_fn_button only_text">
                        <span className="text">Read More</span>
                      </a>
                    </Link>
                  </p>
                </div>
              </li>
              <li>
                <div className="item">
                  <img src="img/blog/6.jpg" alt="" className="moving_img" />
                  <p className="fn_date">
                    <span>April 12, 2022</span>
                  </p>
                  <h3 className="fn_title">
                    <Link href="/blog-single">
                      Crypto-Focused Silvergate Jumps on Blowout Earnings Report
                    </Link>
                  </h3>
                  <p className="fn_desc">
                    Morbi non dignissim erat, a blandit felis nec lorem vel orci
                    varius congue ut vitae est.
                  </p>
                  <p className="fn_read">
                    <Link href="/blog-single">
                      <a className="neoh_fn_button only_text">
                        <span className="text">Read More</span>
                      </a>
                    </Link>
                  </p>
                </div>
              </li>
              <li>
                <div className="item">
                  <img src="img/blog/7.jpg" alt="" className="moving_img" />
                  <p className="fn_date">
                    <span>April 07, 2022</span>
                  </p>
                  <h3 className="fn_title">
                    <Link href="/blog-single">
                      Neoh’s NFT Goes Public In Nod To Crypto Adoption
                    </Link>
                  </h3>
                  <p className="fn_desc">
                    Morbi non dignissim erat, a blandit felis nec lorem vel orci
                    varius congue ut vitae est.
                  </p>
                  <p className="fn_read">
                    <Link href="/blog-single">
                      <a className="neoh_fn_button only_text">
                        <span className="text">Read More</span>
                      </a>
                    </Link>
                  </p>
                </div>
              </li>
              <li>
                <div className="item">
                  <img src="img/blog/8.jpg" alt="" className="moving_img" />
                  <p className="fn_date">
                    <span>April 03, 2022</span>
                  </p>
                  <h3 className="fn_title">
                    <Link href="/blog-single">
                      Bankman-Fried Would Like to Talk With Musk About Twitter
                    </Link>
                  </h3>
                  <p className="fn_desc">
                    Morbi non dignissim erat, a blandit felis nec lorem vel orci
                    varius congue ut vitae est.
                  </p>
                  <p className="fn_read">
                    <Link href="/blog-single">
                      <a className="neoh_fn_button only_text">
                        <span className="text">Read More</span>
                      </a>
                    </Link>
                  </p>
                </div>
              </li>
              <li>
                <div className="item">
                  <img src="img/blog/9.jpg" alt="" className="moving_img" />
                  <p className="fn_date">
                    <span>March 25, 2022</span>
                  </p>
                  <h3 className="fn_title">
                    <Link href="/blog-single">
                      Crypto-Focused Silvergate Jumps on Blowout Earnings Report
                    </Link>
                  </h3>
                  <p className="fn_desc">
                    Morbi non dignissim erat, a blandit felis nec lorem vel orci
                    varius congue ut vitae est.
                  </p>
                  <p className="fn_read">
                    <Link href="/blog-single">
                      <a className="neoh_fn_button only_text">
                        <span className="text">Read More</span>
                      </a>
                    </Link>
                  </p>
                </div>
              </li>
            </ul>
          </div>
          {/* !Moving Blog List Shortcode */}
          {/* Pagination */}
          <div className="neoh_fn_pagination">
            <ul>
              {state &&
                state.map((s, i) => (
                  <li key={i}>
                    <a
                      href="#"
                      className={` ${active === s ? "current" : ""}`}
                      onClick={(e) => {
                        e.preventDefault();
                        setActive(s);
                      }}
                    >
                      {s}
                    </a>
                  </li>
                ))}
            </ul>
          </div>
          {/* !Pagination */}
        </div>
      </div>
    </Layout>
  );
};
export default Blog;
